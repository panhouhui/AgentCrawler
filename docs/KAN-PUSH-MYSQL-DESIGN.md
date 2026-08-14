# Kan 推送配置 MySQL 表设计

目标：把各爬虫平台的 Kan 推送配置和投递记录统一到 OpenCrow，Crawler 只负责产出事件，OpenCrow 负责路由、去重、投递、审计。

## 核心关系

- `kan_platforms`：一个爬虫平台，例如 Telegram、LIHKG、Facebook。
- `kan_channels`：一个 Kan/Mattermost 频道。
- `kan_push_routes`：平台到频道的推送路由，可配置默认频道、状态、过滤策略。
- `kan_route_sources`：平台内部来源，例如 Telegram 群 ID、PTT 看板、Matrix 房间。
- `kan_push_events`：爬虫或智能体上报的待推送事件。
- `kan_push_dispatches`：一次推送调度。
- `kan_push_deliveries`：一次调度到每个频道的投递结果。
- `kan_dedupe_keys`：跨平台/跨频道去重。

## 建议 DDL

```sql
CREATE TABLE kan_platforms (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  platform_key VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(128) NOT NULL,
  crawler_path VARCHAR(512) NULL,
  env_path VARCHAR(512) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE kan_channels (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  channel_id VARCHAR(64) NOT NULL,
  base_url VARCHAR(255) NOT NULL DEFAULT 'https://kan.cool',
  display_name VARCHAR(128) NULL,
  team_id VARCHAR(64) NULL,
  channel_type VARCHAR(32) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_kan_channel (base_url, channel_id)
);

CREATE TABLE kan_credentials (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  credential_key VARCHAR(128) NOT NULL UNIQUE,
  provider VARCHAR(64) NOT NULL DEFAULT 'kan',
  secret_ref VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE kan_push_routes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_key VARCHAR(128) NOT NULL UNIQUE,
  platform_id BIGINT NOT NULL,
  credential_id BIGINT NULL,
  name VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 0,
  filter_json JSON NULL,
  format_template MEDIUMTEXT NULL,
  state_path VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_kan_routes_platform FOREIGN KEY (platform_id) REFERENCES kan_platforms(id),
  CONSTRAINT fk_kan_routes_credential FOREIGN KEY (credential_id) REFERENCES kan_credentials(id)
);

CREATE TABLE kan_push_route_channels (
  route_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (route_id, channel_id),
  CONSTRAINT fk_kan_route_channels_route FOREIGN KEY (route_id) REFERENCES kan_push_routes(id),
  CONSTRAINT fk_kan_route_channels_channel FOREIGN KEY (channel_id) REFERENCES kan_channels(id)
);

CREATE TABLE kan_route_sources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_id BIGINT NOT NULL,
  source_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NULL,
  target_channel_id BIGINT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_kan_route_source (route_id, source_key),
  CONSTRAINT fk_kan_sources_route FOREIGN KEY (route_id) REFERENCES kan_push_routes(id),
  CONSTRAINT fk_kan_sources_channel FOREIGN KEY (target_channel_id) REFERENCES kan_channels(id)
);

CREATE TABLE kan_push_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_key VARCHAR(191) NOT NULL UNIQUE,
  platform_id BIGINT NOT NULL,
  route_id BIGINT NULL,
  source_key VARCHAR(128) NULL,
  title VARCHAR(512) NULL,
  message MEDIUMTEXT NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'normal',
  event_time DATETIME(3) NULL,
  payload_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_kan_events_status_time (status, created_at),
  CONSTRAINT fk_kan_events_platform FOREIGN KEY (platform_id) REFERENCES kan_platforms(id),
  CONSTRAINT fk_kan_events_route FOREIGN KEY (route_id) REFERENCES kan_push_routes(id)
);

CREATE TABLE kan_push_dispatches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  dispatch_key VARCHAR(191) NOT NULL UNIQUE,
  event_id BIGINT NULL,
  route_id BIGINT NOT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_text TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  KEY idx_kan_dispatches_route_time (route_id, created_at),
  CONSTRAINT fk_kan_dispatches_event FOREIGN KEY (event_id) REFERENCES kan_push_events(id),
  CONSTRAINT fk_kan_dispatches_route FOREIGN KEY (route_id) REFERENCES kan_push_routes(id)
);

CREATE TABLE kan_push_deliveries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  dispatch_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  post_id VARCHAR(128) NULL,
  permalink VARCHAR(512) NULL,
  error_text TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_kan_delivery (dispatch_id, channel_id),
  KEY idx_kan_deliveries_channel_time (channel_id, created_at),
  CONSTRAINT fk_kan_deliveries_dispatch FOREIGN KEY (dispatch_id) REFERENCES kan_push_dispatches(id),
  CONSTRAINT fk_kan_deliveries_channel FOREIGN KEY (channel_id) REFERENCES kan_channels(id)
);

CREATE TABLE kan_dedupe_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  dedupe_key VARCHAR(191) NOT NULL UNIQUE,
  platform_id BIGINT NULL,
  event_id BIGINT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  hit_count INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_kan_dedupe_platform FOREIGN KEY (platform_id) REFERENCES kan_platforms(id),
  CONSTRAINT fk_kan_dedupe_event FOREIGN KEY (event_id) REFERENCES kan_push_events(id)
);
```

## 扩展建议

新增平台时只需要新增 `kan_platforms`、`kan_push_routes` 和可选的 `kan_route_sources`，不用改 Crawler 里的推送代码。

密钥不要直接放 MySQL 明文。`kan_credentials.secret_ref` 建议指向 OpenCrow secrets、Vault、环境变量名或加密密钥 ID。

如果后面要支持图片、语音和文件，把附件拆成 `kan_push_attachments` 表，并让 OpenCrow 统一上传 Kan 文件接口，Crawler 只上报本地路径或对象存储地址。
