"""
Graph API — /api/repos/{repo_id}/graph
Builds a GraphData payload (nodes + directed links) from FileNode
dependency data stored in PostgreSQL JSONB columns.

Called by the React ForceGraph3D panel in the dashboard.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.schema import FileNode, Repository, RepoStatus

router = APIRouter(prefix="/api/repos", tags=["graph"])


# ─── Response models ──────────────────────────────────────────────────────────

class GraphNodeOut(BaseModel):
    id:        str
    name:      str
    file_path: str
    node_type: str
    language:  str
    val:       int     # bubble size — proportional to inward caller count


class GraphLinkOut(BaseModel):
    source: str
    target: str
    type:   str        # "call" | "import"


class GraphDataOut(BaseModel):
    nodes: list[GraphNodeOut]
    links: list[GraphLinkOut]


# ─── Route ────────────────────────────────────────────────────────────────────

@router.get("/{repo_id}/graph", response_model=GraphDataOut)
async def get_repo_graph(
    repo_id: str,
    db: AsyncSession = Depends(lambda: None),  # injected by app via Depends(get_db)
) -> GraphDataOut:
    """
    Returns nodes (one per FileNode) and directed edges derived from
    outward_calls and imports JSONB columns.

    Node bubble size (val) = 1 + number of inward callers.
    """
    try:
        repo_uuid = uuid.UUID(repo_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid repository ID format.")

    repo = await db.get(Repository, repo_uuid)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repository not found.")
    if repo.status != RepoStatus.READY.value:
        raise HTTPException(
            status_code=400,
            detail=f"Repository graph not available — status: {repo.status}",
        )

    stmt = select(FileNode).where(FileNode.repository_id == repo_uuid)
    result = await db.execute(stmt)
    file_nodes: list[FileNode] = list(result.scalars().all())

    # Build name → node_id lookup for link resolution
    name_to_id: dict[str, str] = {fn.name: str(fn.id) for fn in file_nodes}

    nodes: list[GraphNodeOut] = []
    links: list[GraphLinkOut] = []
    seen_links: set[tuple[str, str, str]] = set()

    for fn in file_nodes:
        inward: list[str] = (fn.inward_callers or {}).get("items", [])
        val = max(1, 1 + len(inward))

        nodes.append(GraphNodeOut(
            id=str(fn.id),
            name=fn.name,
            file_path=fn.file_path,
            node_type=fn.node_type.value,
            language=fn.language.value,
            val=val,
        ))

        # Outward call edges (function → function)
        calls: list[str] = (fn.outward_calls or {}).get("items", [])
        for callee_name in calls:
            target_id = name_to_id.get(callee_name)
            if target_id and target_id != str(fn.id):
                key = (str(fn.id), target_id, "call")
                if key not in seen_links:
                    seen_links.add(key)
                    links.append(GraphLinkOut(
                        source=str(fn.id),
                        target=target_id,
                        type="call",
                    ))

        # Import edges (module-level)
        import_stmts: list[str] = (fn.imports or {}).get("items", [])
        for import_stmt in import_stmts:
            # Resolve import to a node name (heuristic: last identifier)
            parts = import_stmt.split()
            imported_name = parts[-1] if parts else ""
            target_id = name_to_id.get(imported_name)
            if target_id and target_id != str(fn.id):
                key = (str(fn.id), target_id, "import")
                if key not in seen_links:
                    seen_links.add(key)
                    links.append(GraphLinkOut(
                        source=str(fn.id),
                        target=target_id,
                        type="import",
                    ))

    return GraphDataOut(nodes=nodes, links=links)
