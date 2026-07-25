"""
Module 2 — Tree-sitter AST Chunker
Supports: Python, TypeScript
Strategy:
  1. Walk the syntax tree recursively, extracting top-level and nested nodes.
  2. For each extracted node, attach full metadata (parent class, imports, line range).
  3. If a single node exceeds TOKEN_CEILING, fall back to sub-block splitting
     while retaining the enclosing structural context as a header.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Generator, Optional

import tiktoken
from tree_sitter import Language, Node, Parser
from tree_sitter_languages import get_language, get_parser  # tree_sitter_languages wheels

# ─── Constants ────────────────────────────────────────────────────────────────

TOKEN_CEILING = 512          # Hard max tokens per chunk before sub-block split
TOKEN_OVERLAP = 64           # Token overlap when splitting large nodes into sub-blocks
FALLBACK_LINES = 60          # Line-count ceiling for sub-block splitting fallback

TIKTOKEN_MODEL = "cl100k_base"   # Used by text-embedding-3-small and GPT-4o

# Node type sets per language
PYTHON_EXTRACT_TYPES = frozenset({
    "function_definition",
    "async_function_definition",
    "class_definition",
    "decorated_definition",
})

PYTHON_BLOCK_TYPES = frozenset({
    "block",                 # function/class body block
    "if_statement",
    "for_statement",
    "while_statement",
    "try_statement",
    "with_statement",
})

TYPESCRIPT_EXTRACT_TYPES = frozenset({
    "function_declaration",
    "function_expression",
    "arrow_function",
    "method_definition",
    "class_declaration",
    "export_statement",
    "lexical_declaration",  # const fn = () => {}
})

TYPESCRIPT_BLOCK_TYPES = frozenset({
    "statement_block",
    "if_statement",
    "for_statement",
    "while_statement",
    "try_statement",
})

# ─── Output dataclass ─────────────────────────────────────────────────────────

@dataclass
class CodeChunk:
    file_path: str
    language: str                    # "python" | "typescript"
    node_type: str                   # element_type for vector payload
    name: str
    parent_name: Optional[str]       # enclosing class name if method
    start_line: int
    end_line: int
    raw_content: str
    token_count: int
    code_hash: str
    imports: list[str]               # module-level import names
    inward_callers: list[str]        # populated later by dependency resolver
    outward_calls: list[str]         # calls made from within this chunk
    is_sub_block: bool = False       # True when split from a larger node
    structural_context: str = ""     # header lines retained from parent node


# ─── Tokenizer ────────────────────────────────────────────────────────────────

_enc = tiktoken.get_encoding(TIKTOKEN_MODEL)

def count_tokens(text: str) -> int:
    return len(_enc.encode(text, disallowed_special=()))


# ─── Import extraction helpers ────────────────────────────────────────────────

def _extract_python_imports(root: Node, source: bytes) -> list[str]:
    imports: list[str] = []
    for child in root.children:
        if child.type in ("import_statement", "import_from_statement"):
            imports.append(source[child.start_byte:child.end_byte].decode("utf-8", errors="replace"))
    return imports


def _extract_ts_imports(root: Node, source: bytes) -> list[str]:
    imports: list[str] = []
    for child in root.children:
        if child.type == "import_statement":
            imports.append(source[child.start_byte:child.end_byte].decode("utf-8", errors="replace"))
    return imports


# ─── Outward call extraction ──────────────────────────────────────────────────

_PYTHON_CALL_RE  = re.compile(r'\b([a-zA-Z_]\w*)\s*\(')
_TS_CALL_RE      = re.compile(r'\b([a-zA-Z_$][\w$]*)\s*\(')

def _extract_outward_calls(content: str, language: str) -> list[str]:
    pattern = _PYTHON_CALL_RE if language == "python" else _TS_CALL_RE
    raw = pattern.findall(content)
    # Filter out Python/JS builtins and obvious keywords
    _SKIP = frozenset({
        "if", "for", "while", "return", "print", "len", "range", "str",
        "int", "list", "dict", "set", "tuple", "isinstance", "type",
        "super", "object", "Exception", "True", "False", "None",
        "console", "require", "import", "export", "new", "typeof", "await",
    })
    return list(dict.fromkeys(c for c in raw if c not in _SKIP))


# ─── Name extraction helpers ──────────────────────────────────────────────────

def _get_node_name(node: Node, source: bytes) -> str:
    """Extract the identifier/name child from a definition node."""
    for child in node.children:
        if child.type in ("identifier", "property_identifier", "name"):
            return source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return "<anonymous>"


def _classify_node_type(tree_type: str) -> str:
    mapping = {
        "function_definition":         "function",
        "async_function_definition":   "function",
        "function_declaration":        "function",
        "function_expression":         "function",
        "arrow_function":              "function",
        "lexical_declaration":         "function",
        "class_definition":            "class",
        "class_declaration":           "class",
        "method_definition":           "method",
        "decorated_definition":        "function",
        "export_statement":            "function",
    }
    return mapping.get(tree_type, "block")


# ─── Sub-block splitter ───────────────────────────────────────────────────────

def _split_into_sub_blocks(
    content: str,
    structural_context: str,
    file_path: str,
    language: str,
    name: str,
    parent_name: Optional[str],
    base_start_line: int,
    imports: list[str],
    token_ceiling: int = TOKEN_CEILING,
    overlap: int = TOKEN_OVERLAP,
) -> list[CodeChunk]:
    """
    Split an oversized node into overlapping line-range sub-blocks.
    Each sub-block retains `structural_context` (function/class signature line)
    as a header so the embedding model understands the enclosing scope.
    """
    lines = content.splitlines()
    chunks: list[CodeChunk] = []
    start_idx = 0

    while start_idx < len(lines):
        # Greedily consume lines until token ceiling is hit
        end_idx = start_idx
        block_lines: list[str] = [structural_context] if structural_context else []
        for i in range(start_idx, len(lines)):
            candidate = "\n".join(block_lines + lines[start_idx:i + 1])
            if count_tokens(candidate) > token_ceiling and i > start_idx:
                break
            end_idx = i

        sub_content = "\n".join(lines[start_idx:end_idx + 1])
        full_content = (structural_context + "\n" + sub_content) if structural_context else sub_content
        token_count  = count_tokens(full_content)
        code_hash    = hashlib.sha256(full_content.encode()).hexdigest()

        chunks.append(CodeChunk(
            file_path=file_path,
            language=language,
            node_type="block",
            name=f"{name}__block_{len(chunks)}",
            parent_name=parent_name,
            start_line=base_start_line + start_idx,
            end_line=base_start_line + end_idx,
            raw_content=full_content,
            token_count=token_count,
            code_hash=code_hash,
            imports=imports,
            inward_callers=[],
            outward_calls=_extract_outward_calls(sub_content, language),
            is_sub_block=True,
            structural_context=structural_context,
        ))

        # Advance with overlap to maintain context continuity
        overlap_lines = max(1, overlap // 8)  # approx 8 tokens per line average
        start_idx = end_idx + 1 - overlap_lines
        if start_idx <= 0:
            break

    return chunks


# ─── Core chunker class ───────────────────────────────────────────────────────

class ASTChunker:
    """
    Language-agnostic Tree-sitter chunker.
    Instantiate once per worker process; parsers are thread-safe after build.
    """

    def __init__(self) -> None:
        self._parsers: dict[str, Parser] = {}

    def _get_parser(self, language: str) -> Parser:
        if language not in self._parsers:
            self._parsers[language] = get_parser(language)
        return self._parsers[language]

    # ── Public API ──────────────────────────────────────────────────────────

    def chunk_file(self, file_path: str, source_code: str) -> list[CodeChunk]:
        """
        Entry point. Detects language from extension, parses, and returns chunks.
        Returns an empty list for unsupported extensions.
        """
        language = self._detect_language(file_path)
        if language is None:
            return []

        source_bytes = source_code.encode("utf-8")
        parser        = self._get_parser(language)
        tree          = parser.parse(source_bytes)
        root          = tree.root_node

        if language == "python":
            imports = _extract_python_imports(root, source_bytes)
            return list(self._walk_python(root, source_bytes, file_path, imports))
        elif language in ("typescript", "tsx"):
            imports = _extract_ts_imports(root, source_bytes)
            return list(self._walk_typescript(root, source_bytes, file_path, imports, language))

        return []

    # ── Python walker ───────────────────────────────────────────────────────

    def _walk_python(
        self,
        node: Node,
        source: bytes,
        file_path: str,
        imports: list[str],
        parent_name: Optional[str] = None,
        depth: int = 0,
    ) -> Generator[CodeChunk, None, None]:

        for child in node.children:
            child_type = child.type

            # Unwrap decorated definitions to the inner function/class
            actual = child
            if child_type == "decorated_definition":
                for inner in child.children:
                    if inner.type in ("function_definition", "async_function_definition", "class_definition"):
                        actual = inner
                        break

            if actual.type in PYTHON_EXTRACT_TYPES or child_type == "decorated_definition":
                name = _get_node_name(actual, source)
                content = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                token_count = count_tokens(content)

                # Build structural context from the signature line only
                first_line = content.split("\n")[0]

                if token_count <= TOKEN_CEILING:
                    code_hash = hashlib.sha256(content.encode()).hexdigest()
                    node_type = _classify_node_type(actual.type)

                    yield CodeChunk(
                        file_path=file_path,
                        language="python",
                        node_type=node_type,
                        name=name,
                        parent_name=parent_name,
                        start_line=child.start_point[0] + 1,
                        end_line=child.end_point[0] + 1,
                        raw_content=content,
                        token_count=token_count,
                        code_hash=code_hash,
                        imports=imports,
                        inward_callers=[],
                        outward_calls=_extract_outward_calls(content, "python"),
                    )
                else:
                    # Oversized node: emit sub-blocks
                    yield from _split_into_sub_blocks(
                        content=content,
                        structural_context=first_line,
                        file_path=file_path,
                        language="python",
                        name=name,
                        parent_name=parent_name,
                        base_start_line=child.start_point[0] + 1,
                        imports=imports,
                    )

                # If it's a class, recurse into its body to extract methods
                if actual.type == "class_definition":
                    yield from self._walk_python(
                        actual, source, file_path, imports,
                        parent_name=name, depth=depth + 1
                    )

    # ── TypeScript walker ────────────────────────────────────────────────────

    def _walk_typescript(
        self,
        node: Node,
        source: bytes,
        file_path: str,
        imports: list[str],
        language: str,
        parent_name: Optional[str] = None,
        depth: int = 0,
    ) -> Generator[CodeChunk, None, None]:

        for child in node.children:
            child_type = child.type

            # Unwrap export statements: export default function / export const
            actual = child
            if child_type == "export_statement":
                for inner in child.children:
                    if inner.type in TYPESCRIPT_EXTRACT_TYPES - {"export_statement"}:
                        actual = inner
                        break

            if actual.type in TYPESCRIPT_EXTRACT_TYPES:
                name = _get_node_name(actual, source)
                if not name or name == "<anonymous>":
                    name = f"anonymous_{actual.start_point[0]}"

                content = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                token_count = count_tokens(content)
                first_line  = content.split("\n")[0]

                if token_count <= TOKEN_CEILING:
                    code_hash = hashlib.sha256(content.encode()).hexdigest()
                    node_type = _classify_node_type(actual.type)

                    yield CodeChunk(
                        file_path=file_path,
                        language=language,
                        node_type=node_type,
                        name=name,
                        parent_name=parent_name,
                        start_line=child.start_point[0] + 1,
                        end_line=child.end_point[0] + 1,
                        raw_content=content,
                        token_count=token_count,
                        code_hash=code_hash,
                        imports=imports,
                        inward_callers=[],
                        outward_calls=_extract_outward_calls(content, language),
                    )
                else:
                    yield from _split_into_sub_blocks(
                        content=content,
                        structural_context=first_line,
                        file_path=file_path,
                        language=language,
                        name=name,
                        parent_name=parent_name,
                        base_start_line=child.start_point[0] + 1,
                        imports=imports,
                    )

                # Recurse into class body for methods
                if actual.type in ("class_declaration", "class_expression"):
                    yield from self._walk_typescript(
                        actual, source, file_path, imports, language,
                        parent_name=name, depth=depth + 1
                    )

    # ── Language detection ───────────────────────────────────────────────────

    @staticmethod
    def _detect_language(file_path: str) -> Optional[str]:
        ext = Path(file_path).suffix.lower()
        mapping = {
            ".py":  "python",
            ".ts":  "typescript",
            ".tsx": "tsx",
            ".js":  "javascript",
            ".jsx": "javascript",
            ".go":  "go",
            ".rs":  "rust",
        }
        return mapping.get(ext)
