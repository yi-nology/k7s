//! k7s-deps — 共享依赖管理
//!
//! 统一管理 k7s 项目的常用依赖，避免版本不一致和重复声明。

// HTTP 客户端
pub use reqwest;

// 序列化
pub use serde;
pub use serde_json;
pub use yaml_serde;

// 异步运行时
pub use tokio;
pub use futures;
pub use tokio_stream;
pub use async_stream;
pub use async_trait;

// Kubernetes
pub use kube;
pub use k8s_openapi;

// 错误处理
pub use thiserror;
pub use anyhow;

// 日志
pub use tracing;
pub use tracing_subscriber;

// 时间处理
pub use chrono;
pub use jiff;

// 工具库
pub use uuid;
pub use keyring;
pub use urlencoding;
pub use regex;
pub use rand;
pub use dirs;
pub use dunce;
pub use http;
pub use base64;
pub use flate2;
pub use rustls;
