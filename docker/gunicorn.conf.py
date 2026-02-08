bind = "0.0.0.0:5000"
worker_class = "geventwebsocket.gunicorn.workers.GeventWebSocketWorker"
workers = 1
timeout = 120
keepalive = 5
accesslog = "-"
errorlog = "-"
loglevel = "info"
