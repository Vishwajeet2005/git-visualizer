from typing import List, Tuple
from sentence_transformers import CrossEncoder

class RerankerService:
    _instance = None
    
    def __new__(cls, model_name: str = "BAAI/bge-reranker-base"):
        if cls._instance is None:
            cls._instance = super(RerankerService, cls).__new__(cls)
            # max_length=512 ensures we don't exceed the model's token limit
            cls._instance.model = CrossEncoder(model_name, max_length=512)
        return cls._instance

    def rerank(self, query: str, documents: List[str], top_k: int = 5) -> List[Tuple[int, float]]:
        """
        Reranks a list of documents against a query using the CrossEncoder.
        Returns a list of tuples containing (original_index, score), sorted by score descending.
        Only returns the top_k results.
        """
        if not documents:
            return []
            
        pairs = [[query, doc] for doc in documents]
        scores = self.model.predict(pairs)
        
        scored_docs = [(i, float(score)) for i, score in enumerate(scores)]
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        
        return scored_docs[:top_k]

