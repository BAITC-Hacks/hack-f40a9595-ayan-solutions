"""Run the local UI and API together; keep the analytic CLI independently usable."""
import argparse
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--production", action="store_true", help="Requires npm run build in web/")
    args = parser.parse_args()
    for port in (args.port, args.api_port):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                parser.error(f"Port {port} is occupied. Choose --port and --api-port explicitly.")
    next_cli = ROOT / "web/node_modules/next/dist/bin/next"
    if not next_cli.is_file():
        parser.error("Run npm ci --prefix web first.")
    env = {**os.environ, "GRAPH_API_URL": f"http://127.0.0.1:{args.api_port}",
           "GRAPH_UI_ORIGIN": f"http://127.0.0.1:{args.port}"}
    processes = []
    try:
        processes.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", str(args.api_port)], cwd=ROOT, env=env))
        processes.append(subprocess.Popen(["node", str(next_cli), "start" if args.production else "dev", "--hostname", "127.0.0.1", "--port", str(args.port)], cwd=ROOT / "web", env=env))
        print(f"Graph Money: http://127.0.0.1:{args.port}/network", flush=True)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        while all(process.poll() is None for process in processes):
            time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
