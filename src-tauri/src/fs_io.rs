//! 文件编码探测与读写（对应指南 §6.4 / 原 main.js detectEncoding 等）

use encoding_rs::{GB18030, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

/// 编码探测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRead {
    pub content: String,
    /// 归一化编码名：UTF-8 / UTF-16LE / UTF-16BE / GBK
    pub encoding: String,
    /// 是否带 BOM
    pub bom: bool,
}

/// BOM 探测
fn bom_of(data: &[u8]) -> Option<(&'static str, bool)> {
    if data.len() >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
        return Some(("UTF-8", true));
    }
    if data.len() >= 2 {
        if data[0] == 0xFF && data[1] == 0xFE {
            return Some(("UTF-16LE", true));
        }
        if data[0] == 0xFE && data[1] == 0xFF {
            return Some(("UTF-16BE", true));
        }
    }
    None
}

/// 无 BOM 的 UTF-16 LE/BE 特征检测（采样前 1024 字节双字节零比）
fn utf16_detect(data: &[u8]) -> Option<&'static str> {
    if data.len() < 4 {
        return None;
    }
    let samples = data.len().min(1024);
    let mut zeros_le = 0usize;
    let mut zeros_be = 0usize;
    let mut pairs = 0usize;
    let mut i = 0usize;
    while i + 1 < samples {
        if data[i + 1] == 0 {
            zeros_le += 1;
        }
        if data[i] == 0 {
            zeros_be += 1;
        }
        pairs += 1;
        i += 2;
    }
    if pairs == 0 {
        return None;
    }
    let half = pairs as f64;
    if (zeros_le as f64) > half * 0.5 {
        return Some("UTF-16LE");
    }
    if (zeros_be as f64) > half * 0.5 {
        return Some("UTF-16BE");
    }
    None
}

/// 严格校验是否为合法 UTF-8（无 BOM 时优先尝试）
fn is_valid_utf8(data: &[u8]) -> bool {
    std::str::from_utf8(data).is_ok()
}

/// 探测编码并解码为 String
pub fn read_bytes(data: &[u8]) -> FileRead {
    // 1) BOM 优先
    if let Some((enc, bom)) = bom_of(data) {
        let (content, _enc, _had_errs) = match enc {
            "UTF-8" => UTF_8.decode(&data[3..]),
            "UTF-16LE" => UTF_16LE.decode(&data[2..]),
            _ => UTF_16BE.decode(&data[2..]),
        };
        return FileRead {
            content: content.into_owned(),
            encoding: enc.to_string(),
            bom,
        };
    }

    // 2) UTF-16 双字节零比特征
    if let Some(enc) = utf16_detect(data) {
        let (content, _e, _h) = if enc == "UTF-16LE" {
            UTF_16LE.decode(data)
        } else {
            UTF_16BE.decode(data)
        };
        return FileRead {
            content: content.into_owned(),
            encoding: enc.to_string(),
            bom: false,
        };
    }

    // 3) UTF-8 严格校验
    if is_valid_utf8(data) {
        return FileRead {
            content: String::from_utf8_lossy(data).into_owned(),
            encoding: "UTF-8".to_string(),
            bom: false,
        };
    }

    // 4) 兜底 GBK（Windows 中文常见）
    let (content, _e, _h) = GB18030.decode(data);
    FileRead {
        content: content.into_owned(),
        encoding: "GBK".to_string(),
        bom: false,
    }
}

/// 按指定编码 + BOM 选项编码为字节
pub fn encode_bytes(content: &str, encoding: &str, bom: bool) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    match encoding {
        "UTF-16LE" => {
            if bom {
                out.extend_from_slice(&[0xFF, 0xFE]);
            }
            // encoding_rs 的便捷 encode() 对 ASCII 有误导性优化，必须经 encode_utf16 构造
            for u in content.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
        }
        "UTF-16BE" => {
            if bom {
                out.extend_from_slice(&[0xFE, 0xFF]);
            }
            for u in content.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
        }
        "GBK" | "GB18030" => {
            let (enc, _, _) = GB18030.encode(content);
            out.extend_from_slice(&enc);
        }
        _ => {
            // 默认 UTF-8
            if bom {
                out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            out.extend_from_slice(content.as_bytes());
        }
    }
    out
}

/// 归一化编码名：GB18030 → GBK，lowercase → uppercase
pub fn normalize_encoding(enc: &str) -> String {
    match enc {
        "gbk" | "gb18030" | "GB18030" => "GBK".to_string(),
        "utf8" | "utf-8" | "UTF8" => "UTF-8".to_string(),
        "utf16le" | "utf-16le" | "UTF16LE" => "UTF-16LE".to_string(),
        "utf16be" | "utf-16be" | "UTF16BE" => "UTF-16BE".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_utf8_bom() {
        let mut b = vec![0xEF, 0xBB, 0xBF];
        b.extend_from_slice("你好".as_bytes());
        let r = read_bytes(&b);
        assert_eq!(r.encoding, "UTF-8");
        assert!(r.bom);
        assert_eq!(r.content, "你好");
    }

    #[test]
    fn detect_utf8_plain() {
        let r = read_bytes("hello 世界".as_bytes());
        assert_eq!(r.encoding, "UTF-8");
        assert!(!r.bom);
        assert_eq!(r.content, "hello 世界");
    }

    #[test]
    fn detect_utf16le_bom() {
        let b = encode_bytes("中文测试", "UTF-16LE", true);
        assert_eq!(&b[0..2], &[0xFF, 0xFE]);
        let r = read_bytes(&b);
        assert_eq!(r.encoding, "UTF-16LE");
        assert!(r.bom);
        assert_eq!(r.content, "中文测试");
    }

    #[test]
    fn detect_utf16le_nobom() {
        // 手动构造 UTF-16LE 字节（无 BOM）："abcd" -> [61 00 62 00 63 00 64 00]
        let bytes: Vec<u8> = "abcd".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let r = read_bytes(&bytes);
        assert_eq!(r.encoding, "UTF-16LE");
        assert_eq!(r.content, "abcd");
    }

    #[test]
    fn detect_gbk() {
        // "你好" 的 GBK 字节（无法通过 UTF-8 解析）
        let gbk = [0xC4, 0xE3, 0xBA, 0xC3]; // 你好
        let r = read_bytes(&gbk);
        assert_eq!(r.encoding, "GBK");
        assert_eq!(r.content, "你好");
    }

    #[test]
    fn roundtrip_utf16le_bom() {
        let bytes = encode_bytes("你好world", "UTF-16LE", true);
        assert_eq!(&bytes[0..2], &[0xFF, 0xFE]);
        let r = read_bytes(&bytes);
        assert_eq!(r.content, "你好world");
        assert_eq!(r.encoding, "UTF-16LE");
    }

    #[test]
    fn roundtrip_gbk() {
        let bytes = encode_bytes("中文GBK", "GBK", false);
        let r = read_bytes(&bytes);
        assert_eq!(r.encoding, "GBK");
        assert_eq!(r.content, "中文GBK");
    }

    #[test]
    fn normalize() {
        assert_eq!(normalize_encoding("GB18030"), "GBK");
        assert_eq!(normalize_encoding("UTF-8"), "UTF-8");
    }
}