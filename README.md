# StegoPix

**StegoPix** is a modern Web UI tool built on top of [blind\_watermark](https://github.com/guofei9987/blind_watermark). It makes the embedding and extraction of image blind watermarks simple and intuitive, allowing you to use powerful hidden watermark functionality without writing any code.

## ✨ Key Features

  * **Visual Operation**: Intuitive Web interface, eliminating the command line.
  * **Smart Adjustment**: Supports automatic adjustment of image embedding parameters to adapt to different image sources.
  * **Multi-Mode Support**: Built-in support for three mainstream watermark embedding algorithms.
  * **Decoupled Frontend/Backend**: Based on a modern tech stack (Backend: Python/uv, Frontend: Bun/Vue/React).

## 🚀 Quick Start

### Method 1: Run from Source (Manual)

Ensure your environment has [uv](https://github.com/astral-sh/uv) and [Bun](https://bun.sh/) installed.

1.  **Clone the Project**

    ```bash
    git clone https://github.com/Mgrsc/StegoPix.git
    cd StegoPix
    ```

2.  **Start the Backend**

    ```bash
    cd backend
    uv run main.py
    ```

3.  **Start the Frontend** (Open a new terminal window)

    ```bash
    cd frontend
    bun run dev
    ```

-----

### Method 2: Docker Deployment

This project provides containerization support; you can run it directly:

Check the `docker-compose.yaml` file in the root directory for configuration details, then run:

```bash
docker-compose up -d
```

## 🔗 Acknowledgements

The core algorithm of this project originates from [guofei9987/blind\_watermark](https://github.com/guofei9987/blind_watermark). Thanks to the original author for their outstanding work.