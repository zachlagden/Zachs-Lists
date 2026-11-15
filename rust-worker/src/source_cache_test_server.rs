use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub pieces: usize,
    pub pause_between_pieces: Duration,
    pub declares_length: bool,
    pub stalls_after_pieces: Option<usize>,
}

impl Reply {
    pub fn new(status: u16, body: &[u8]) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.to_vec(),
            pieces: 1,
            pause_between_pieces: Duration::ZERO,
            declares_length: true,
            stalls_after_pieces: None,
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn dripped(mut self, pieces: usize, pause_between_pieces: Duration) -> Self {
        self.pieces = pieces.max(1);
        self.pause_between_pieces = pause_between_pieces;
        self
    }

    pub fn stalled_after(mut self, pieces: usize) -> Self {
        self.stalls_after_pieces = Some(pieces);
        self
    }

    pub fn without_length(mut self) -> Self {
        self.declares_length = false;
        self
    }
}

pub struct TestServer {
    pub address: SocketAddr,
    pub requests: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}

impl TestServer {
    pub async fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let replies = Arc::new(Mutex::new(VecDeque::from(replies)));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let task = tokio::spawn(async move {
            loop {
                let (mut connection, _) = listener.accept().await.unwrap();
                let replies = replies.clone();
                let captured = captured.clone();
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    loop {
                        let mut bytes = [0; 1024];
                        let count = tokio::time::timeout(
                            Duration::from_secs(2),
                            connection.read(&mut bytes),
                        )
                        .await
                        .unwrap()
                        .unwrap();
                        if count == 0 {
                            return;
                        }
                        request.extend_from_slice(&bytes[..count]);
                        assert!(request.len() <= 16384);
                        if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                            break;
                        }
                    }
                    captured
                        .lock()
                        .unwrap()
                        .push(String::from_utf8(request).unwrap());
                    let reply = replies
                        .lock()
                        .unwrap()
                        .pop_front()
                        .unwrap_or_else(|| Reply::new(500, b""));
                    let stalls_after_pieces = reply.stalls_after_pieces;
                    if stalls_after_pieces == Some(0) {
                        std::future::pending::<()>().await;
                    }
                    let mut response =
                        format!("HTTP/1.1 {} Fixture\r\nConnection: close\r\n", reply.status);
                    if reply.declares_length
                        && !reply
                            .headers
                            .iter()
                            .any(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    {
                        response.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
                    }
                    for (name, value) in reply.headers {
                        response.push_str(&format!("{}: {}\r\n", name, value));
                    }
                    response.push_str("\r\n");
                    let _ = connection.write_all(response.as_bytes()).await;
                    let piece_size = reply.body.len().div_ceil(reply.pieces).max(1);
                    for (sent, piece) in reply.body.chunks(piece_size).enumerate() {
                        if stalls_after_pieces == Some(sent) {
                            std::future::pending::<()>().await;
                        }
                        let _ = connection.write_all(piece).await;
                        let _ = connection.flush().await;
                        tokio::time::sleep(reply.pause_between_pieces).await;
                    }
                    let _ = connection.shutdown().await;
                });
            }
        });
        Self {
            address,
            requests,
            task,
        }
    }

    pub fn recorded_requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://source.example:{}{}", self.address.port(), path)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
