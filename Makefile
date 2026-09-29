PYTHON ?= python
PNPM ?= pnpm

.PHONY: setup data train api web test demo
setup:
	$(PYTHON) -m pip install -r requirements-train.txt
	cd frontend && $(PNPM) install
data:
	$(PYTHON) -m backend.data.generate_synthetic
train:
	$(PYTHON) -m backend.pipeline.train
api:
	$(PYTHON) -m backend.app
web:
	cd frontend && $(PNPM) dev
test:
	$(PYTHON) -m pytest backend/tests -q
	cd frontend && $(PNPM) test
demo:
	docker compose up --build
