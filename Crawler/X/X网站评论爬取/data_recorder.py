# -*- coding: utf-8 -*-
"""
数据导出模块 - 将搜索结果追加保存为CSV

特性：
  - 追加写入：新数据追加到文件末尾，不覆盖已有数据
  - 自动创建：文件不存在时自动创建并写入表头
  - UTF-8-BOM编码：Excel直接打开不乱码
"""

import os
import csv
from datetime import datetime

import config

# CSV的列定义：(显示名称, 数据字典的key)
COLUMNS = [
    ("发现来源", "discovery_source"),
    ("事件查询", "event_query"),
    ("账号", "handle"),          # Twitter账号，如 @elonmusk
    ("昵称", "name"),            # 用户显示名称
    ("主页位置", "location"),    # 用户主页设置的位置
    ("简介", "bio"),             # 用户主页的个人简介
    ("帖子链接", "tweet_link"),  # 推文永久链接
    ("帖子内容", "tweet_text"),  # 推文正文内容
    ("发帖时间", "tweet_time"),  # 推文发布时间
    ("回复数", "reply_count"),
    ("转发数", "repost_count"),
    ("点赞数", "like_count"),
    ("浏览数", "view_count"),
    ("评论数", "comment_count"),
]


class DataRecorder:
    """
    数据导出器 - 追加写入CSV文件

    每次启动脚本生成一个文件名，后续所有数据追加到同一个文件。
    """

    def __init__(self):
        # 启动时生成一次文件名
        os.makedirs(config.OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.csv_path = os.path.join(config.OUTPUT_DIR, f"{config.OUTPUT_FILENAME}_{timestamp}.csv")
        self._header_written = False  # 标记表头是否已写入

    def save(self, data: list[dict]) -> str:
        """
        追加写入CSV（新数据追加到文件末尾）

        参数:
            data: 推文数据列表

        返回:
            csv文件路径
        """
        # 第一次写入时创建文件并写表头
        if not self._header_written:
            with open(self.csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow([h for h, _ in COLUMNS])
            self._header_written = True

        # 追加数据行
        with open(self.csv_path, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            for row in data:
                writer.writerow([row.get(k, "") for _, k in COLUMNS])

        print(f"  ✓ CSV已保存: {self.csv_path} (本次写入 {len(data)} 条)")
        return self.csv_path
