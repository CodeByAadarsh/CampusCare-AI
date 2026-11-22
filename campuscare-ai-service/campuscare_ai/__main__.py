"""Run the service:  python -m campuscare_ai   (uses HOST and PORT, default 127.0.0.1:8001)."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "campuscare_ai.api:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8001")),
    )
