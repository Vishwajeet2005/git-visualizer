import os
import uuid
from typing import AsyncIterator, Optional, List, Literal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from openai import AsyncOpenAI
import structlog

from backend.schema import create_engine, create_session_factory
from backend.reranker import RerankerService
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langchain_core.tools import tool

log = structlog.get_logger(__name__)

OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")
OPENAI_EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")
raw_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus")
if raw_url.startswith("postgres://"):
    raw_url = raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif raw_url.startswith("postgresql://"):
    raw_url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
DATABASE_URL = raw_url
InferenceProvider = Literal["openai", "anthropic", "ollama"]

class EmbeddingService:
    def __init__(self, api_key: Optional[str] = None) -> None:
        key = api_key or os.environ.get("OPENAI_API_KEY")
        self._client = AsyncOpenAI(api_key=key)
        self.model_name = OPENAI_EMBED_MODEL
        self.dense_dim = 1536

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        response = await self._client.embeddings.create(
            input=texts,
            model=self.model_name,
            dimensions=self.dense_dim,
        )
        return [item.embedding for item in response.data]

    async def embed_single(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

class PostgresSearchService:
    def __init__(self, embedder: EmbeddingService, db_factory):
        self.embedder = embedder
        self.db_factory = db_factory
        self.reranker = RerankerService()

    async def search(self, query: str, repository_id: str, top_k: int = 50, final_k: int = 8) -> List[dict]:
        query_emb = await self.embedder.embed_single(query)
        repo_uuid = uuid.UUID(repository_id)
        
        async with self.db_factory() as session:
            stmt = text("""
                SELECT id, file_path, name, start_line, end_line, element_type, raw_content, 
                       (dense_vector <=> :embedding) AS distance
                FROM vector_chunks
                WHERE repository_id = :repo_id
                ORDER BY distance ASC
                LIMIT :limit
            """)
            
            result = await session.execute(stmt, {
                "embedding": str(query_emb),
                "repo_id": repo_uuid,
                "limit": top_k
            })
            
            rows = result.mappings().all()
            if not rows:
                return []
                
            docs = [row["raw_content"] for row in rows]
            
            reranked = self.reranker.rerank(query, docs, top_k=final_k)
            
            final_results = []
            for idx, score in reranked:
                row = rows[idx]
                final_results.append({
                    "id": str(row["id"]),
                    "file_path": row["file_path"],
                    "name": row["name"],
                    "start_line": row["start_line"],
                    "end_line": row["end_line"],
                    "element_type": row["element_type"],
                    "chunk_content": row["raw_content"],
                    "score": score
                })
                
            return final_results

@tool
async def search_codebase(query: str, repository_id: str) -> str:
    """Searches the codebase for snippets matching the query."""
    search_svc = search_codebase.search_svc
    results = await search_svc.search(query, repository_id)
    if not results:
        return "No results found."
    
    parts = []
    for r in results:
        parts.append(f"### {r['file_path']}:{r['start_line']}-{r['end_line']} [{r['element_type']}: {r['name']}]\n{r['chunk_content']}\n")
    return "\n".join(parts)

@tool
async def read_file(file_path: str, repository_id: str) -> str:
    """Reads the full content of a file from the codebase given its path."""
    search_svc = read_file.search_svc
    async with search_svc.db_factory() as session:
        stmt = text("""
            SELECT raw_content FROM file_nodes 
            WHERE repository_id = :repo_id AND file_path = :file_path 
            LIMIT 1
        """)
        result = await session.execute(stmt, {"repo_id": uuid.UUID(repository_id), "file_path": file_path})
        row = result.mappings().first()
        if row:
            return row["raw_content"]
        return "File not found."

@tool
async def get_symbol_graph(symbol_name: str, repository_id: str) -> str:
    """Gets the callers (upstream) and calls (downstream) of a specific function or class."""
    search_svc = get_symbol_graph.search_svc
    async with search_svc.db_factory() as session:
        stmt = text("""
            SELECT inward_callers, outward_calls FROM vector_chunks
            WHERE repository_id = :repo_id AND name = :name
            LIMIT 1
        """)
        result = await session.execute(stmt, {"repo_id": uuid.UUID(repository_id), "name": symbol_name})
        row = result.mappings().first()
        if not row:
            return f"Symbol {symbol_name} not found."
        
        inward = row.get("inward_callers") or {}
        outward = row.get("outward_calls") or {}
        inward_list = inward.get("items", []) if isinstance(inward, dict) else []
        outward_list = outward.get("items", []) if isinstance(outward, dict) else []
        
        return f"Symbol: {symbol_name}\nCallers (uses this symbol): {inward_list}\nCalls (this symbol uses): {outward_list}"

from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    repository_id: str

class AgenticInferenceEngine:
    def __init__(self, search_svc: PostgresSearchService, api_key: str):
        self.search_svc = search_svc
        self.api_key = api_key
        
        search_codebase.search_svc = search_svc
        read_file.search_svc = search_svc
        get_symbol_graph.search_svc = search_svc
        
        self.tools = [search_codebase, read_file, get_symbol_graph]
        self.llm = ChatOpenAI(model=OPENAI_MODEL, api_key=api_key, streaming=True)
        self.llm_with_tools = self.llm.bind_tools(self.tools)
        
        graph_builder = StateGraph(AgentState)
        
        async def chatbot(state: AgentState):
            messages = state["messages"]
            response = await self.llm_with_tools.ainvoke(messages)
            return {"messages": [response]}
            
        from langgraph.prebuilt import ToolNode
        tool_node = ToolNode(self.tools)
        
        graph_builder.add_node("chatbot", chatbot)
        graph_builder.add_node("tools", tool_node)
        graph_builder.add_conditional_edges(
            "chatbot",
            self.route_tools,
            {"tools": "tools", "__end__": END}
        )
        graph_builder.add_edge("tools", "chatbot")
        graph_builder.set_entry_point("chatbot")
        self.graph = graph_builder.compile()

    def route_tools(self, state: AgentState):
        if isinstance(state, list):
            ai_message = state[-1]
        elif messages := state.get("messages", []):
            ai_message = messages[-1]
        else:
            raise ValueError("No messages in state")
            
        if hasattr(ai_message, "tool_calls") and len(ai_message.tool_calls) > 0:
            return "tools"
        return "__end__"
        
    async def stream(self, question: str, repository_id: str, system_prompt: str) -> AsyncIterator[str]:
        sp = f"{system_prompt}\nCRITICAL: When calling tools, you MUST provide repository_id='{repository_id}' as an argument."
        messages = [
            SystemMessage(content=sp),
            HumanMessage(content=question)
        ]
        
        async for event in self.graph.astream_events(
            {"messages": messages, "repository_id": repository_id},
            version="v2"
        ):
            kind = event["event"]
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if chunk.content:
                    if isinstance(chunk.content, str):
                        yield chunk.content
                    elif isinstance(chunk.content, list):
                        for c in chunk.content:
                            if "text" in c:
                                yield c["text"]

class QueryService:
    def __init__(self, api_key: Optional[str] = None) -> None:
        self.embedder = EmbeddingService(api_key=api_key)
        engine = create_engine(DATABASE_URL)
        self.db_factory = create_session_factory(engine)
        self.search_svc = PostgresSearchService(self.embedder, self.db_factory)
        self.engine = AgenticInferenceEngine(self.search_svc, api_key or "")

    async def query(
        self,
        question: str,
        collection_name: str,
        repository_id: str,
        provider: str = "openai",
        system_prompt: Optional[str] = None,
    ) -> AsyncIterator[str]:
        
        sp = system_prompt or (
            "You are a senior software engineer Agent equipped with tools to search a codebase. "
            "Use the `search_codebase` tool to find relevant code snippets. "
            "Use `read_file` to read the full context if snippets are not enough. "
            "Use `get_symbol_graph` to find function callers and dependencies. "
            "Cite file paths and line numbers. Be precise."
        )
        
        async for token in self.engine.stream(question, repository_id, sp):
            yield token

    async def aclose(self) -> None:
        pass
