# -*- coding: utf-8 -*-
import os, subprocess, tempfile
import config

def concat_to_wav(part_paths, out_wav):
    if not part_paths:
        raise RuntimeError("沒有錄音段落")
    listf = out_wav + ".txt"
    with open(listf, "w", encoding="utf-8") as f:
        for p in part_paths:
            f.write("file '" + p.replace("'", "'\\''") + "'\n")
    cmd = [config.FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", listf,
           "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out_wav]
    res = subprocess.run(cmd, capture_output=True, text=True)
    try: os.remove(listf)
    except OSError: pass
    if res.returncode != 0 or not os.path.exists(out_wav):
        raise RuntimeError("ffmpeg 串接失敗：" + (res.stderr or "")[-300:])
