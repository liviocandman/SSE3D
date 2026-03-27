import google.generativeai as genai
from loguru import logger
from app.core.config import settings

genai.configure(api_key=settings.gemini_api_key)

BODY_LABELS = {
    "10":  ("Sun", "Sol"),       "199": ("Mercury", "Mercúrio"),
    "299": ("Venus", "Vênus"),   "399": ("Earth", "Terra"),
    "499": ("Mars", "Marte"),    "599": ("Jupiter", "Júpiter"),
    "699": ("Saturn", "Saturno"),"799": ("Uranus", "Urano"),
    "899": ("Neptune", "Netuno"),"999": ("Pluto", "Plutão"),
    "301": ("Moon", "Lua"),
    "401": ("Phobos", "Fobos"),  "402": ("Deimos", "Deimos"),
    "501": ("Io", "Io"),         "502": ("Europa", "Europa"),
    "503": ("Ganymede", "Ganimedes"), "504": ("Callisto", "Calisto"),
    "601": ("Mimas", "Mimas"),   "602": ("Enceladus", "Encélado"),
    "603": ("Tethys", "Tétis"),  "604": ("Dione", "Dione"),
    "605": ("Rhea", "Reia"),     "606": ("Titan", "Titã"),
    "608": ("Iapetus", "Jápeto"),
    "701": ("Ariel", "Ariel"),   "702": ("Umbriel", "Umbriel"),
    "703": ("Titania", "Titânia"),"704": ("Oberon", "Oberon"),
    "705": ("Miranda", "Miranda"),
    "801": ("Triton", "Tritão"), "901": ("Charon", "Caronte"),
}

def generate_system_prompt(
    body_id: str,
    target_date: str,
    body_type: str | None,
    parent_name: str | None,
) -> str:
    en_name, pt_name = BODY_LABELS.get(body_id, ("this body", "este corpo"))
    base = "Você é o Astrônomo Virtual do Solar Explorer 3D. "
    rules = (
        "\nSeja conciso, científico e envolvente. "
        "Use no máximo 2 parágrafos curtos. "
        "IMPORTANTE: Nunca deixe uma frase incompleta."
    )

    if body_type == "MOON":
        parent = parent_name or "seu planeta"
        ctx = (
            f"O utilizador viajou e está a visualizar de perto a lua {en_name} ({pt_name}), "
            f"um satélite natural de {parent}, na data simulada {target_date}. "
            f"Responda focando-se na geologia, astrofísica e curiosidades desta lua específica "
            f"e da sua relação dinâmica com {parent}."
        )
    elif body_type == "STAR":
        ctx = (
            f"O utilizador está a observar o Sol ({en_name}) na data {target_date}. "
            f"Foque-se em física solar, atividade magnética e impacto no sistema solar."
        )
    else:
        ctx = (
            f"O utilizador está a visualizar {en_name} ({pt_name}) na data simulada {target_date}. "
            f"Responda sobre astronomia e {en_name} de forma didática e envolvente."
        )

    return base + ctx + rules

def _ensure_complete_sentence(text: str) -> str:
    """
    If the response was truncated, try to cut it back to the last complete sentence.
    """
    text = text.strip()
    if not text:
        return ""
    
    # Check if ends with terminal punctuation
    if text[-1] in ".!?":
        return text
    
    # Find last occurrence of punctuation
    last_dot = max(text.rfind("."), text.rfind("!"), text.rfind("?"))
    if last_dot != -1:
        return text[:last_dot + 1]
    
    return text

async def ask_astronomer(
    body_id: str,
    target_date: str,
    question: str,
    body_type: str | None = None,
    parent_name: str | None = None,
) -> str:
    system_prompt = generate_system_prompt(body_id, target_date, body_type, parent_name)

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

    try:
        response = await model.generate_content_async(
            question,
            generation_config=genai.GenerationConfig(
                max_output_tokens=1024, # Increased to avoid truncating valid answers
                temperature=0.7,
            ),
            safety_settings=safety_settings
        )

        finish_reason = response.candidates[0].finish_reason
        logger.info(f"AI Finish reason: {finish_reason}")
        
        # Coletando texto
        try:
            text = response.text.strip()
        except Exception:
            parts = []
            if response.candidates and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'text'):
                        parts.append(part.text)
            text = "".join(parts).strip()

        # Pos-processing to ensure complete sentences
        # 2 corresponds to FinishReason.MAX_TOKENS. Only truncate if we hit the token limit.
        if finish_reason == 2:
            final_text = _ensure_complete_sentence(text)
        else:
            final_text = text
        
        logger.debug(f"Question: {question[:50]}...")
        logger.debug(f"Response length: {len(final_text)}")
        
        return final_text if final_text else "O astrônomo não conseguiu completar o raciocínio. Tente perguntar de outra forma."

    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return "Desculpe, o rádio espacial está com interferência. Tente novamente em instantes."

