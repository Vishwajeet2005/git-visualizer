from typing import List, Tuple

class RerankerService:
    _instance = None
    
    def __new__(cls, model_name: str = "BAAI/bge-reranker-base"):
        if cls._instance is None:
            cls._instance = super(RerankerService, cls).__new__(cls)
            # ML reranker removed for Render Free Tier compatibility (OOM prevention)
            cls._instance.model = None
        return cls._instance

    def rerank(self, query: str, documents: List[str], top_k: int = 5) -> List[Tuple[int, float]]:
        """
        Mock reranker for memory-constrained environments.
        Just returns the original indices and a dummy score.
        """
        if not documents:
            return []
            
        scored_docs = [(i, 1.0 - (i * 0.01)) for i in range(len(documents))]
        return scored_docs[:top_k]

