"""Carrega e valida a taxonomia do usuário (data/taxonomy.yaml)."""

import yaml

from .config import TAXONOMY_FILE


def load() -> dict:
    return yaml.safe_load(TAXONOMY_FILE.read_text()) or {}


def valid(tax: dict, category: str | None, subcategory: str | None) -> bool:
    if category is None:
        return False
    if category not in tax:
        return False
    if subcategory is None:
        return True
    return subcategory in (tax.get(category) or [])
