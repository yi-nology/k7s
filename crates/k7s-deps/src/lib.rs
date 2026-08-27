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
pub use async_stream;
pub use async_trait;
pub use futures;
pub use tokio;
pub use tokio_stream;

// Kubernetes
pub use k8s_openapi;
pub use kube;

// 错误处理
pub use anyhow;
pub use thiserror;

// 日志
pub use tracing;
pub use tracing_subscriber;

// 时间处理
pub use chrono;
pub use jiff;

// 工具库
pub use base64;
pub use dirs;
pub use dunce;
pub use flate2;
pub use http;
pub use keyring;
pub use rand;
pub use regex;
pub use rustls;
pub use rustls_pemfile;
pub use tokio_rustls;
pub use urlencoding;
pub use uuid;
