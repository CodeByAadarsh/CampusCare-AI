FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY campuscare_ai ./campuscare_ai
COPY training ./training
COPY data ./data
COPY reports ./reports

# Train at build time so the container starts instantly.
RUN python -m training.train

ENV HOST=0.0.0.0 PORT=8001 AUTO_TRAIN=0
EXPOSE 8001
CMD ["python", "-m", "campuscare_ai"]
