"""HTTP tests. Needs the dev requirements:  pip install -r requirements-dev.txt"""
import pytest
from fastapi.testclient import TestClient

from campuscare_ai.api import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # runs the startup that loads (or trains) the models
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_analyze(client):
    r = client.post("/analyze", json={"description": "Sparks are coming from the switch board in ECE Lab 3"})
    assert r.status_code == 200
    body = r.json()
    assert body["category"] == "electrical" and body["severity"] == 5
    assert body["extracted"]["location"] == "ECE Lab 3"


def test_extract(client):
    r = client.post("/extract", json={"text": "No water in the boys hostel washroom since morning"})
    assert r.status_code == 200
    assert r.json()["location"] == "Boys Hostel · Washroom" and r.json()["occurredAt"]


def test_analyze_validates_input(client):
    assert client.post("/analyze", json={"description": ""}).status_code == 422
    assert client.post("/analyze", json={}).status_code == 422


def test_embed_and_similarity(client):
    r = client.post("/embed", json={"text": "Wifi not working in the library"})
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == len(body["embedding"]) > 0
    same = client.post("/similarity", json={"a": "lift stuck in block A", "b": "block A lift got stuck between floors"}).json()
    diff = client.post("/similarity", json={"a": "lift stuck in block A", "b": "mess food is stale"}).json()
    assert same["similarity"] > diff["similarity"]


def test_info(client):
    body = client.get("/info").json()
    assert len(body["categories"]) == 9
