from app import app, init_db, start_sampler, HTTP_PORT

if __name__ == "__main__":
    init_db()
    start_sampler()
    app.run(host="127.0.0.1", port=HTTP_PORT, debug=True)
