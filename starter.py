#!/usr/bin/env python3
"""One-command local recalculation of the three required CSV exports."""

import argparse
from pathlib import Path

from analysis import run_pipeline


def main():
    parser = argparse.ArgumentParser(description="Анализ направленного графа внутрибанковских переводов")
    parser.add_argument("--data", type=Path, default=Path("data"), help="Каталог с тремя parquet")
    parser.add_argument("--out", type=Path, default=Path("out"), help="Каталог выгрузок")
    parser.add_argument("--config", type=Path, help="JSON с порогами и параметрами алгоритма")
    arguments = parser.parse_args()
    result = run_pipeline(arguments.data, arguments.out, arguments.config)
    print(f"Рассчитано {len(result.roles)} узлов, {len(result.clusters)} кластеров за {result.manifest['seconds']} с")
    print(f"Выгрузки: {arguments.out.resolve()}")


if __name__ == "__main__":
    main()
