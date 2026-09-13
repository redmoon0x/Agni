use std::io::Read;

/// Reads newline-delimited records from a stream, invoking `on_record` with the
/// record bytes (excluding the trailing LF) and an `overflowed` flag. A record
/// longer than `limit` is discarded whole so the next record still parses.
/// Returning `false` from the callback aborts the loop.
pub fn read_lf_records<R, F>(reader: &mut R, limit: usize, mut on_record: F)
where
    R: Read,
    F: FnMut(&[u8], bool) -> bool,
{
    let mut read_buffer = [0u8; 8192];
    let mut record = Vec::with_capacity(8192);
    let mut overflowed = false;
    loop {
        let count = match reader.read(&mut read_buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for &byte in &read_buffer[..count] {
            if byte == b'\n' {
                if !on_record(&record, overflowed) {
                    return;
                }
                record.clear();
                overflowed = false;
            } else if !overflowed {
                if record.len() < limit {
                    record.push(byte);
                } else {
                    record.clear();
                    overflowed = true;
                }
            }
        }
    }
    if !record.is_empty() || overflowed {
        on_record(&record, overflowed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lf_records_preserve_unicode_separators() {
        let source = b"{\"message\":\"a\xE2\x80\xA8b\"}\n{\"type\":\"done\"}\r\n";
        let mut records = Vec::new();
        read_lf_records(&mut &source[..], 1024, |line, overflowed| {
            records.push((line.to_vec(), overflowed));
            true
        });
        assert_eq!(records.len(), 2);
        assert!(records[0]
            .0
            .windows(3)
            .any(|part| part == [0xE2, 0x80, 0xA8]));
        assert!(!records[0].1);
    }

    #[test]
    fn oversized_record_is_discarded_without_losing_next_record() {
        let source = b"123456789\nok\n";
        let mut records = Vec::new();
        read_lf_records(&mut &source[..], 4, |line, overflowed| {
            records.push((line.to_vec(), overflowed));
            true
        });
        assert_eq!(records, vec![(Vec::new(), true), (b"ok".to_vec(), false)]);
    }
}
