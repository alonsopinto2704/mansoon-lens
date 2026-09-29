"""Real-data adapter contract. All rainfall values are daily millimetres at 08:30 IST."""
from typing import Protocol
import pandas as pd


class ForecastAdapter(Protocol):
    def load(self, path: str) -> pd.DataFrame: ...


class ObservationAdapter(Protocol):
    def load(self, path: str) -> pd.DataFrame: ...
