"""
HTTP API used by campuscare-backend (set AI_SERVICE_URL=http://localhost:8001 in the backend's .env).

  POST /analyze     { description, category? }  -> { category, confidence, alternatives, severity, urgency,
                                                     safetyImpact, signals, model, details }
  POST /embed       { text }                    -> { embedding, dim, model }
  POST /extract     { text }                    -> { location, occurredAt, whenText, recurring, peopleCount, manyAffected, missing }
  POST /similarity  { a, b }                    -> { similarity, model }        (handy for demos)
  GET  /health                                  -> service and model status
  GET  /info                                    -> labels, model details and the latest evaluation numbers

Interactive docs: http://localhost:8001/docs
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import __version__
from .analyzer import Analyzer, load_analyzer
from .config import ROOT, load_settings
from .embeddings import cosine
from .extract import extract_details
from .labels import CATEGORIES, CATEGORY_LABELS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("campuscare_ai")

state: dict = {}


@asynccontextmanager
async def lifespan(app):
    settings = load_settings()
    state["settings"] = settings
    state["analyzer"] = load_analyzer(settings)
    log.info("CampusCare AI ready: classifier=%s embedder=%s", state["analyzer"].classifier_name, state["analyzer"].embedder.name)
    yield
    state.clear()


app = FastAPI(
    title="CampusCare AI service",
    version=__version__,
    description="Classifies campus complaints, estimates severity, urgency and safety risk, and produces "
                "sentence embeddings for duplicate detection.",
    lifespan=lifespan,
)


# ---------------------------------------------------------------- schemas
class AnalyzeIn(BaseModel):
    description: str = Field(..., min_length=3, max_length=4000, examples=["The switchboard in ECE Lab 3 is sparking"])
    category: Optional[str] = Field(None, description="Category chosen by the student, if any (optional)")


class Alternative(BaseModel):
    category: str
    confidence: float


class AnalyzeOut(BaseModel):
    category: str
    confidence: float
    alternatives: List[Alternative]
    severity: int = Field(..., ge=1, le=5)
    urgency: int = Field(..., ge=1, le=5)
    safetyImpact: float = Field(..., ge=0, le=1)
    signals: List[str]
    model: str
    extracted: dict
    details: dict


class EmbedIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class EmbedOut(BaseModel):
    embedding: List[float]
    dim: int
    model: str


class SimilarityIn(BaseModel):
    a: str = Field(..., min_length=1, max_length=4000)
    b: str = Field(..., min_length=1, max_length=4000)


class SimilarityOut(BaseModel):
    similarity: float
    model: str


def analyzer() -> Analyzer:
    a = state.get("analyzer")
    if a is None:
        raise HTTPException(status_code=503, detail="Models are still loading.")
    return a


# ---------------------------------------------------------------- routes
@app.get("/health")
def health():
    a = state.get("analyzer")
    return {
        "ok": a is not None,
        "version": __version__,
        "classifier": a.classifier_name if a else None,
        "embedder": a.embedder.name if a else None,
    }


@app.get("/info")
def info():
    a = analyzer()
    report = ROOT / "reports" / "metrics.json"
    return {
        "version": __version__,
        "categories": [{"id": c, "label": CATEGORY_LABELS[c]} for c in CATEGORIES],
        "classifier": a.classifier_name,
        "embedder": {"name": a.embedder.name, "dim": a.embedder.dim},
        "training": a.classical.meta,
        "evaluation": json.loads(report.read_text()).get("summary") if report.exists() else None,
    }


@app.post("/analyze", response_model=AnalyzeOut)
def analyze(body: AnalyzeIn):
    text = body.description.strip()
    if len(text) < 3:
        raise HTTPException(status_code=422, detail="Description is too short.")
    return analyzer().analyze(text, body.category)


@app.post("/embed", response_model=EmbedOut)
def embed(body: EmbedIn):
    a = analyzer()
    vector = a.embed(body.text.strip() or body.text)
    return {"embedding": vector, "dim": len(vector), "model": a.embedder.name}


class ExtractIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


@app.post("/extract")
def extract(body: ExtractIn):
    """Location, time noticed and people affected, pulled from the complaint text."""
    return extract_details(body.text)


@app.post("/similarity", response_model=SimilarityOut)
def similarity(body: SimilarityIn):
    a = analyzer()
    va, vb = a.embedder.encode([body.a, body.b])
    return {"similarity": round(cosine(np.asarray(va), np.asarray(vb)), 4), "model": a.embedder.name}
