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
    pub delay: Duration,
}

impl Reply {
    pub fn new(status: u16, body: &[u8]) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.to_vec(),
            delay: Duration::ZERO,
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn delayed(mut self, delay: Duration) -> Self {
        self.delay = delay;
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
                    tokio::time::sleep(reply.delay).await;
                    let mut response =
                        format!("HTTP/1.1 {} Fixture\r\nConnection: close\r\n", reply.status);
                    if !reply
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
                    let _ = connection.write_all(&reply.body).await;
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
