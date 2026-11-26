"""
Qwen3-VL-8B-Instruct Vision Identification Service (replaces YOLO).
Follows Instructions_Diet.md:
- Never asks the VLM to estimate calories, vitamins, or minerals.
- Returns strict JSON:
  {
    "image_scope": "single_item | multi_item | assortment",
    "items": [
      { "name": "Food Name", "confidence": "high | medium | low", "visible_toppings": [] }
    ]
  }
Supports 3 modes via backend/.env (VLM_MODE):
  1. local_unsloth  -> Runs unsloth/Qwen3-VL-8B-Instruct-unsloth-bnb-4bit directly on Linux CUDA GPU.
  2. remote_http    -> Forwards the uploaded photo to VLM_REMOTE_URL (e.g. Colab T4 GPU or cloud GPU server).
  3. demo_fallback  -> Returns realistic Qwen3-VL JSON locally on CPU so the full app + master_nutrition.csv can be tested immediately.
"""
import hashlib
import io
import json
from typing import Any, Dict, Tuple
from PIL import Image
from app.config import settings

ANTI_LOOP_PROMPT = """Identify every distinct edible food or drink item in this image.

Rules:
- Put small garnishes, sprinkles, or toppings (such as chopped onion, chili, coriander, nuts, sev, or sauces on a dish) inside visible_toppings.
- Never repeat the same item name multiple times. For a box of mixed sweets or snacks, list each distinct type once (up to 12 items).
- Use clear, standard food names (prefer "Poha / Flattened rice" over "Puffed rice snack").
- Do not guess hidden oils or nutritional values.
- Return ONLY valid JSON:
{
  "image_scope": "single_item | multi_item | assortment",
  "items": [
    {
      "name": "Food Name",
      "confidence": "high | medium | low",
      "visible_toppings": []
    }
  ]
}"""


def parse_json(text: str) -> Tuple[Dict[str, Any], bool]:
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1:
        try:
            return json.loads(text[s : e + 1]), True
        except json.JSONDecodeError:
            pass
    return {"raw_text": text, "image_scope": "single_item", "items": []}, False


class Qwen3VLMService:
    def __init__(self):
        self._model = None
        self._tokenizer = None

    def _load_unsloth_model(self):
        if self._model is not None and self._tokenizer is not None:
            return self._model, self._tokenizer
        from unsloth import FastVisionModel

        model, tokenizer = FastVisionModel.from_pretrained(
            settings.vlm_model_name,
            load_in_4bit=True,
            use_gradient_checkpointing="unsloth",
        )
        FastVisionModel.for_inference(model)
        self._model = model
        self._tokenizer = tokenizer
        return model, tokenizer

    def _run_local_unsloth(self, image_bytes: bytes) -> Dict[str, Any]:
        import torch

        model, tokenizer = self._load_unsloth_model()
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img.thumbnail((768, 768))

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": img},
                    {"type": "text", "text": ANTI_LOOP_PROMPT},
                ],
            }
        ]
        try:
            inputs = tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=True,
                return_dict=True,
                return_tensors="pt",
            ).to("cuda")
        except Exception:
            prompt_text = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
            inputs = tokenizer(img, prompt_text, add_special_tokens=False, return_tensors="pt").to("cuda")

        with torch.no_grad():
            out_ids = model.generate(
                **inputs,
                max_new_tokens=900,
                repetition_penalty=1.15,
                use_cache=True,
                temperature=0.1,
                min_p=0.1,
                do_sample=True,
            )

        prompt_len = inputs["input_ids"].shape[1]
        raw_out = tokenizer.decode(out_ids[0][prompt_len:], skip_special_tokens=True).strip()
        parsed, ok = parse_json(raw_out)
        if not ok:
            return {"image_scope": "single_item", "items": [], "raw_text": raw_out}
        return parsed

    def _run_remote_http(self, image_bytes: bytes) -> Dict[str, Any]:
        import httpx

        url = settings.vlm_remote_url.strip()
        if not url:
            raise ValueError("VLM_REMOTE_URL is empty in .env")
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                url,
                headers={"ngrok-skip-browser-warning": "true"},
                files={"photo": ("meal.jpg", image_bytes, "image/jpeg")},
            )
            resp.raise_for_status()
            return resp.json()

    def _run_demo_fallback(self, image_bytes: bytes, meal_type: str) -> Dict[str, Any]:
        digest = int(hashlib.md5(image_bytes[:4096] or b"meal").hexdigest()[:8], 16)
        mt = (meal_type or "Lunch").lower()
        if "breakfast" in mt:
            presets = [
                {
                    "image_scope": "multi_item",
                    "items": [
                        {"name": "Poha", "confidence": "high", "visible_toppings": ["roasted peanuts", "chopped coriander", "onion"]},
                        {"name": "Banana", "confidence": "high", "visible_toppings": []},
                    ],
                },
                {
                    "image_scope": "multi_item",
                    "items": [
                        {"name": "Idli", "confidence": "high", "visible_toppings": []},
                        {"name": "Sambar", "confidence": "high", "visible_toppings": []},
                        {"name": "Coconut chutney", "confidence": "medium", "visible_toppings": []},
                    ],
                },
            ]
        elif "snack" in mt:
            presets = [
                {
                    "image_scope": "single_item",
                    "items": [{"name": "Apple", "confidence": "high", "visible_toppings": []}],
                },
                {
                    "image_scope": "multi_item",
                    "items": [
                        {"name": "Samosa", "confidence": "high", "visible_toppings": ["green chutney"]},
                        {"name": "Hot tea (Garam Chai)", "confidence": "high", "visible_toppings": []},
                    ],
                },
            ]
        else:
            presets = [
                {
                    "image_scope": "multi_item",
                    "items": [
                        {"name": "Poori", "confidence": "high", "visible_toppings": []},
                        {"name": "Chana Masala", "confidence": "high", "visible_toppings": ["onion", "green chili"]},
                        {"name": "Carrot", "confidence": "medium", "visible_toppings": []},
                    ],
                },
                {
                    "image_scope": "multi_item",
                    "items": [
                        {"name": "Chapati", "confidence": "high", "visible_toppings": []},
                        {"name": "Dal", "confidence": "high", "visible_toppings": ["coriander leaves"]},
                        {"name": "Plain rice", "confidence": "high", "visible_toppings": []},
                    ],
                },
            ]
        return presets[digest % len(presets)]

    def identify_food(self, image_bytes: bytes, meal_type: str = "Lunch") -> Dict[str, Any]:
        mode = (settings.vlm_mode or "demo_fallback").strip().lower()
        if mode == "local_unsloth":
            return self._run_local_unsloth(image_bytes)
        if mode == "remote_http":
            return self._run_remote_http(image_bytes)
        return self._run_demo_fallback(image_bytes, meal_type)


vlm_service = Qwen3VLMService()
