"""
Graph API — /api/repos/{repo_id}/graph
Builds a GraphData payload (nodes + directed links) from FileNode
dependency data stored in PostgreSQL JSONB columns.

Called by the React ForceGraph3D panel in the dashboard.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from typing import AsyncIterator
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

async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.db_factory() as session:
        yield session

@router.get("/{repo_id}/graph", response_model=GraphDataOut)
async def get_repo_graph(
    repo_id: str,
    db: AsyncSession = Depends(get_db),
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

    dir_nodes: dict[str, GraphNodeOut] = {}

    for fn in file_nodes:
        inward: list[str] = (fn.inward_callers or {}).get("items", [])
        val = max(1, 1 + len(inward))

        nodes.append(GraphNodeOut(
            id=str(fn.id),
            name=fn.name,
            file_path=fn.file_path,
            node_type=getattr(fn.node_type, "value", fn.node_type),
            language=getattr(fn.language, "value", fn.language),
            val=val,
        ))

        # Synthesize structural directory/file nodes
        parts = fn.file_path.strip("/").split("/")
        current_path = ""
        for i, part in enumerate(parts):
            parent_path = current_path
            current_path = f"{current_path}/{part}" if current_path else part
            
            if i < len(parts) - 1:
                # Directory node
                dir_id = f"dir:{current_path}"
                if dir_id not in dir_nodes:
                    dir_nodes[dir_id] = GraphNodeOut(
                        id=dir_id, name=part, file_path=current_path,
                        node_type="directory", language="text", val=2,
                    )
                if parent_path:
                    key = (f"dir:{parent_path}", dir_id, "structure")
                    if key not in seen_links:
                        seen_links.add(key)
                        links.append(GraphLinkOut(source=f"dir:{parent_path}", target=dir_id, type="structure"))
            else:
                # File structural node
                file_id = f"file:{current_path}"
                if file_id not in dir_nodes:
                    dir_nodes[file_id] = GraphNodeOut(
                        id=file_id, name=part, file_path=current_path,
                        node_type="file", language=getattr(fn.language, "value", fn.language), val=2,
                    )
                    if parent_path:
                        key = (f"dir:{parent_path}", file_id, "structure")
                        if key not in seen_links:
                            seen_links.add(key)
                            links.append(GraphLinkOut(source=f"dir:{parent_path}", target=file_id, type="structure"))
                
                # Link file structural node to actual AST chunk node
                key = (file_id, str(fn.id), "structure")
                if key not in seen_links:
                    seen_links.add(key)
                    links.append(GraphLinkOut(source=file_id, target=str(fn.id), type="structure"))

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

    nodes.extend(dir_nodes.values())

    return GraphDataOut(nodes=nodes, links=links)
