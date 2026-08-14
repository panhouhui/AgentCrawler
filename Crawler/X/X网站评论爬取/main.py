# -*- coding: utf-8 -*-
"""兼容入口：转发到 X 根目录下的 AgentHub 工具 CLI。"""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from x_agent_tool import main


if __name__ == "__main__":
    raise SystemExit(main())
