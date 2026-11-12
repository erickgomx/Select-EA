import os
import sys
import json
import argparse
from pathlib import Path

# Suprime avisos de console do OpenCV DNN
os.environ["OPENCV_LOG_LEVEL"] = "ERROR"
import cv2
try:
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except Exception:
    pass

import numpy as np

SUPPORTED_EXTS = {
    '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif',
    '.arw', '.cr2', '.cr3', '.nef', '.dng', '.raf'
}

def extract_jpeg_from_raw(file_path: str) -> bytes | None:
    ext = Path(file_path).suffix.lower()
    if ext in {'.jpg', '.jpeg', '.png', '.webp'}:
        try:
            with open(file_path, 'rb') as f:
                return f.read()
        except Exception:
            return None

    # Para RAW (ARW, CR2, NEF, DNG, etc.)
    try:
        with open(file_path, 'rb') as f:
            head = f.read(4 * 1024 * 1024)
            soi_markers = []
            pos = 0
            while True:
                idx = head.find(b'\xff\xd8\xff', pos)
                if idx == -1:
                    break
                soi_markers.append(idx)
                pos = idx + 3

            largest_jpeg = None
            for soi in soi_markers:
                f.seek(soi)
                chunk = f.read(3 * 1024 * 1024)
                eoi = chunk.find(b'\xff\xd9')
                if eoi > 5000:
                    candidate = chunk[:eoi + 2]
                    if largest_jpeg is None or len(candidate) > len(largest_jpeg):
                        largest_jpeg = candidate

            return largest_jpeg
    except Exception:
        return None

def compute_dhash(img_gray, hash_size=8) -> int:
    """Calcula dHash perceptual de 64 bits para comparação visual de cenas."""
    resized = cv2.resize(img_gray, (hash_size + 1, hash_size))
    diff = resized[:, 1:] > resized[:, :-1]
    return sum([2 ** i for (i, v) in enumerate(diff.flatten()) if v])

def hamming_distance(h1: int, h2: int) -> int:
    return bin(h1 ^ h2).count('1')

def evaluate_exposure(img_gray) -> float:
    """
    Avalia superexposição (clipping de brancos) e subexposição.
    Retorna penalidade entre 0.0 (perfeito) e 30.0 (estourado/escuro).
    """
    total_pixels = img_gray.size
    blown_whites = np.count_nonzero(img_gray >= 252) / total_pixels
    crushed_blacks = np.count_nonzero(img_gray <= 5) / total_pixels

    penalty = 0.0
    # Se mais de 4% da foto for branco puro estourado
    if blown_whites > 0.04:
        penalty += min(25.0, (blown_whites - 0.04) * 200.0)
    # Se mais de 10% da foto for preto total
    if crushed_blacks > 0.10:
        penalty += min(15.0, (crushed_blacks - 0.10) * 100.0)

    return penalty

def analyze_photo(detector, file_path: str):
    jpeg_bytes = extract_jpeg_from_raw(file_path)
    if not jpeg_bytes:
        return {
            'blurScore': 50.0,
            'eyesOpen': True,
            'faceCount': 0,
            'isKissingOrClose': False,
            'smileScore': 0.0,
            'exposurePenalty': 0.0,
            'dHash': 0
        }

    img = cv2.imdecode(np.frombuffer(jpeg_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {
            'blurScore': 50.0, 'eyesOpen': True, 'faceCount': 0,
            'isKissingOrClose': False, 'smileScore': 0.0, 'exposurePenalty': 0.0, 'dHash': 0
        }

    h, w = img.shape[:2]
    gray_full = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dhash_val = compute_dhash(gray_full)
    exposure_penalty = evaluate_exposure(gray_full)

    detector.setInputSize((w, h))
    faces_res = detector.detect(img)
    faces = faces_res[1]

    if faces is not None and len(faces) > 0:
        face_count = len(faces)

        # Ordena rostos por área decrescente (sujeito principal primeiro)
        face_data = []
        for face in faces:
            bbox = face[0:4]
            fx, fy, fw, fh = map(int, bbox)
            fx = max(0, min(w - 1, fx))
            fy = max(0, min(h - 1, fy))
            fw = max(1, min(w - fx, fw))
            fh = max(1, min(h - fy, fh))
            area = fw * fh

            face_crop = img[fy:fy+fh, fx:fx+fw]
            if face_crop.size == 0:
                continue

            gray_face = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
            lap_var = cv2.Laplacian(gray_face, cv2.CV_64F).var()

            # Avaliação dos olhos nos marcos faciais
            # face[4..7]: right_eye (x, y), left_eye (x, y)
            eyes_open = True
            for (ex, ey) in [(face[4], face[5]), (face[6], face[7])]:
                ex, ey = int(ex), int(ey)
                ew, eh = max(4, int(fw * 0.12)), max(4, int(fh * 0.10))
                y1 = max(0, ey - eh)
                y2 = min(h, ey + eh)
                x1 = max(0, ex - ew)
                x2 = min(w, ex + ew)
                eye_crop = gray_face if (fx <= x1 and x2 <= fx+fw and fy <= y1 and y2 <= fy+fh) else None
                if eye_crop is not None and eye_crop.size > 20:
                    sobel_y = cv2.Sobel(eye_crop, cv2.CV_64F, 0, 1, ksize=3)
                    eye_grad_var = float(np.var(sobel_y))
                    if eye_grad_var < 45.0:
                        eyes_open = False

            # Avaliação de sorriso (largura da boca / distância entre olhos)
            interpupil_dist = max(1.0, np.hypot(face[6] - face[4], face[7] - face[5]))
            mouth_width = np.hypot(face[10] - face[8], face[11] - face[9])
            smile_ratio = mouth_width / interpupil_dist
            is_smiling = smile_ratio > 0.82

            face_data.append({
                'area': area,
                'lap_var': lap_var,
                'eyes_open': eyes_open,
                'is_smiling': is_smiling,
                'bbox': (fx, fy, fw, fh),
                'center': (fx + fw / 2, fy + fh / 2)
            })

        face_data.sort(key=lambda x: x['area'], reverse=True)

        if not face_data:
            return {'blurScore': 50.0, 'eyesOpen': True, 'faceCount': 0, 'isKissingOrClose': False, 'smileScore': 0.0, 'exposurePenalty': exposure_penalty, 'dHash': dhash_val}

        # Detecção de Beijo ou Abraço Íntimo
        is_kissing_or_close = False
        if len(face_data) >= 2:
            f1, f2 = face_data[0], face_data[1]
            dist_centers = np.hypot(f1['center'][0] - f2['center'][0], f1['center'][1] - f2['center'][1])
            avg_width = (f1['bbox'][2] + f2['bbox'][2]) / 2.0
            if dist_centers < avg_width * 1.35:
                is_kissing_or_close = True

        # Ponderação do Sujeito Principal
        max_area = face_data[0]['area']
        weighted_sharpness = 0.0
        total_weight = 0.0
        primary_eyes_open = True
        has_smile = False

        for idx, fd in enumerate(face_data):
            relative_size = fd['area'] / max_area
            # Ignora pessoas minúsculas no fundo (< 12% da área do sujeito principal)
            if relative_size < 0.12:
                continue

            weight = relative_size ** 1.5
            weighted_sharpness += fd['lap_var'] * weight
            total_weight += weight

            # Apenas o sujeito principal e o parceiro/noiva determinam o descarte por piscada
            if idx < 2:
                if not fd['eyes_open']:
                    primary_eyes_open = False
                if fd['is_smiling']:
                    has_smile = True

        avg_lap = weighted_sharpness / max(1.0, total_weight)
        normalized_blur = float(min(99.0, max(20.0, 30.0 + 10.0 * np.log10(max(1.0, avg_lap)) * 15.0)))

        return {
            'blurScore': round(normalized_blur, 1),
            'eyesOpen': primary_eyes_open,
            'faceCount': face_count,
            'isKissingOrClose': is_kissing_or_close,
            'smileScore': 12.0 if has_smile else 0.0,
            'exposurePenalty': round(exposure_penalty, 1),
            'dHash': dhash_val
        }
    else:
        # Foto de detalhe / decoração sem pessoas
        cy1, cy2 = int(h * 0.2), int(h * 0.8)
        cx1, cx2 = int(w * 0.2), int(w * 0.8)
        center_crop = img[cy1:cy2, cx1:cx2]
        gray = cv2.cvtColor(center_crop, cv2.COLOR_BGR2GRAY)
        lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        normalized_blur = float(min(98.0, max(20.0, 35.0 + 9.0 * np.log10(max(1.0, lap_var)) * 14.0)))

        return {
            'blurScore': round(normalized_blur, 1),
            'eyesOpen': True,
            'faceCount': 0,
            'isKissingOrClose': False,
            'smileScore': 0.0,
            'exposurePenalty': round(exposure_penalty, 1),
            'dHash': dhash_val
        }

def get_model_path(model_arg: str) -> Path:
    p = Path(model_arg)
    if p.is_absolute() and p.exists():
        return p

    candidates = []
    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            candidates.append(Path(meipass) / model_arg)
            candidates.append(Path(meipass) / "models" / Path(model_arg).name)
            candidates.append(Path(meipass) / Path(model_arg).name)
        exe_dir = Path(sys.executable).resolve().parent
        candidates.append(exe_dir / model_arg)
        candidates.append(exe_dir / "models" / Path(model_arg).name)
        candidates.append(exe_dir / Path(model_arg).name)

    try:
        script_dir = Path(__file__).resolve().parent
        candidates.append(script_dir / model_arg)
        candidates.append(script_dir / "models" / Path(model_arg).name)
    except Exception:
        pass

    candidates.append(Path.cwd() / model_arg)
    candidates.append(Path.cwd() / "models" / Path(model_arg).name)

    for cand in candidates:
        if cand.exists():
            return cand

    return candidates[0] if candidates else Path(model_arg)

def main():
    parser = argparse.ArgumentParser(description="AI Culling Worker v2")
    parser.add_argument("--dir", required=True, help="Diretório de fotos")
    parser.add_argument("--model", default="models/yunet.onnx", help="Caminho do modelo ONNX")
    parser.add_argument("--output", default=None, help="Caminho do arquivo JSON de resultado")
    args = parser.parse_args()

    target_dir = Path(args.dir)
    if not target_dir.exists():
        print(json.dumps({"error": "Directory does not exist"}))
        return

    model_path = get_model_path(args.model)

    detector = cv2.FaceDetectorYN.create(str(model_path), "", (640, 640), score_threshold=0.6)

    photo_files = []
    for item in target_dir.iterdir():
        if item.is_file() and item.suffix.lower() in SUPPORTED_EXTS:
            photo_files.append(item)

    photo_files.sort(key=lambda p: p.stat().st_mtime)
    total = len(photo_files)

    results = []

    for idx, p in enumerate(photo_files):
        metrics = analyze_photo(detector, str(p))
        stats = p.stat()

        results.append({
            'id': p.name,
            'name': p.name,
            'path': str(p),
            'sizeBytes': stats.st_size,
            'modifiedTime': stats.st_mtime * 1000,
            'isRaw': p.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'},
            'blurScore': metrics['blurScore'],
            'eyesOpen': metrics['eyesOpen'],
            'faceCount': metrics['faceCount'],
            'isKissingOrClose': metrics['isKissingOrClose'],
            'smileScore': metrics['smileScore'],
            'exposurePenalty': metrics['exposurePenalty'],
            'dHash': metrics['dHash'],
            'rating': 0,
            'colorLabel': None,
            'isRecommended': False,
            'groupId': 1
        })

        if (idx + 1) % 5 == 0 or idx == total - 1:
            progress = {
                'type': 'progress',
                'current': idx + 1,
                'total': total,
                'percent': round(((idx + 1) / total) * 100, 1)
            }
            print(json.dumps(progress), flush=True)

    # Agrupamento Híbrido: Tempo (< 3.0s) + Similaridade Visual Perceptual (dHash <= 15)
    groups = {}
    current_grp = 1
    for i in range(len(results)):
        if i > 0:
            diff_sec = abs(results[i]['modifiedTime'] - results[i-1]['modifiedTime']) / 1000
            hash_dist = hamming_distance(results[i]['dHash'], results[i-1]['dHash'])

            # Se passou de 3s OU se a cena visual for completamente diferente
            if diff_sec > 3.0 or hash_dist > 16:
                current_grp += 1

        results[i]['groupId'] = current_grp
        groups.setdefault(current_grp, []).append(results[i])

    # Eleição do Top Pick com Regras Robustas
    for grp_id, items in groups.items():
        # Verifica se TODOS do grupo têm olhos fechados (ex: beijo prolongado ou oração)
        all_burst_closed = all(not it['eyesOpen'] and it['faceCount'] > 0 for it in items)

        for item in items:
            score = item['blurScore'] + item['smileScore'] - item['exposurePenalty']

            # Se for pose íntima (beijo/abraço) OU se todos da rajada estão de olhos fechados, NÃO penaliza
            if item['isKissingOrClose'] or all_burst_closed:
                pass # Pose intencional preservada
            elif item['faceCount'] > 0 and not item['eyesOpen']:
                score -= 60.0 # Penaliza apenas piscada acidental isolada

            item['_compositeScore'] = score

        items.sort(key=lambda x: x['_compositeScore'], reverse=True)

        for rank, item in enumerate(items):
            if rank == 0:
                item['isRecommended'] = True
                item['rating'] = 5
                item['colorLabel'] = 'green'
            elif item['faceCount'] > 0 and not item['eyesOpen'] and not item['isKissingOrClose'] and not all_burst_closed:
                # Piscada real confirmada
                item['isRecommended'] = False
                item['rating'] = 1
                item['colorLabel'] = 'red'
            elif item['blurScore'] < 60.0:
                item['isRecommended'] = False
                item['rating'] = 2
                item['colorLabel'] = None
            else:
                item['isRecommended'] = False
                item['rating'] = 3
                item['colorLabel'] = None

            # Limpeza de campos internos antes de serializar
            del item['_compositeScore']
            del item['dHash']

    out_path = Path(args.output) if args.output else target_dir / ".culling_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)

    print(json.dumps({"type": "complete", "output_file": str(out_path)}), flush=True)

if __name__ == '__main__':
    main()
