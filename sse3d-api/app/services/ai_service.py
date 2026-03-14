import google.generativeai as genai
from app.core.config import settings

genai.configure(api_key=settings.gemini_api_key)

PLANET_LABELS = {
    "10":  ("Sun", "Sol"),       "199": ("Mercury", "Mercúrio"),
    "299": ("Venus", "Vênus"),   "399": ("Earth", "Terra"),
    "499": ("Mars", "Marte"),    "599": ("Jupiter", "Júpiter"),
    "699": ("Saturn", "Saturno"),"799": ("Uranus", "Urano"),
    "899": ("Neptune", "Netuno"),
}

async def ask_astronomer(body_id: str, target_date: str, question: str) -> str:
    en_name, pt_name = PLANET_LABELS.get(body_id, ("Unknown", "Desconhecido"))

    system_prompt = (
        f"Você é o Astrônomo Virtual do Solar Explorer 3D. "
        f"O usuário está visualizando {en_name} ({pt_name}) na data simulada {target_date}. "
        f"Responda sobre astronomia e {en_name} de forma didática e envolvente. "
        f"Use no máximo 2 parágrafos curtos. "
        f"IMPORTANTE: Nunca deixe uma frase incompleta. Termine sua explicação de forma clara."
    )

    # Configurando segurança como BLOCK_NONE para teste de debug (evitar truncamento falso positivo)
    safety_settings = [
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]

    model = genai.GenerativeModel(
        model_name=settings.gemini_model,
        system_instruction=system_prompt,
    )

    response = await model.generate_content_async(
        question,
        generation_config=genai.GenerationConfig(
            max_output_tokens=1024,
            temperature=0.7,
        ),
        safety_settings=safety_settings
    )

    print(f"[AI Service] Finish reason: {response.candidates[0].finish_reason}")
    
    # Coletando todas as partes de texto explicitamente
    try:
        text = response.text.strip()
    except Exception:
        # Fallback se .text falhar (ex: por filtro de segurança)
        parts = []
        if response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'text'):
                    parts.append(part.text)
        text = "".join(parts).strip()

    print(f"[AI Service] Question: {question}")
    print(f"[AI Service] Response length: {len(text)}")
    return text if text else "O astrônomo não conseguiu completar o raciocínio. Tente perguntar de outra forma."
