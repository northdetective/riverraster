# heightmapper

http://tangrams.github.io/heightmapper

Tangrams made the original heightmapper. I just overlaid NHD data for water mask export and a rotatable bounding box with RCT2 mapping in mind

### To run locally:

Clone the repo

Open a terminal window in the repo's directory and start the web server:

    python -m http.server 8000

If running this produces CORS errors on your local machine, try:

    python run-server.py

or

    python3 run-server.py (on mac)
    
Then navigate to: [http://localhost:8000](http://localhost:8000)

Stadia API allows apps running on localhost to run without an API key, though at a rate limit.
