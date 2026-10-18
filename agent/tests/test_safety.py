import pytest

from agents.llm import Models
from agents.safety import L3_TEMPLATE, L3Stream, SafetyClassifier, l3_violations
from app.config import Settings
from app.schemas import RiskLevel


@pytest.mark.parametrize(
    ("text", "kinds"),
    [
        ("Coba minum sertraline setiap pagi.", ["medication"]),
        ("Dosisnya 50 mg saja.", ["dosage"]),
        ("Sepertinya kamu menderita depresi.", ["diagnosis"]),
        ("Kamu pasti bipolar.", ["diagnosis"]),
        ("Kamu sudah lama mengalami gangguan kecemasan.", ["diagnosis"]),
        ("Ceritakan lebih banyak tentang hari ini.", []),
        ("Depresi adalah topik yang bisa kamu bahas dengan psikolog.", []),
        ("Jalan kaki 10 menit bisa membantu.", []),
    ],
)
def test_l3_patterns(text: str, kinds: list[str]) -> None:
    assert l3_violations(text) == kinds


def test_l3_stream_never_releases_a_flagged_word() -> None:
    stream = L3Stream()
    released: list[str] = []
    for delta in ["Coba ", "minum ", "sert", "raline ", "50 ", "mg."]:
        out = stream.feed(delta)
        if out:
            released.append(out)
    assert "sertraline" not in "".join(released)
    content, replaced = stream.finish("Coba minum sertraline 50 mg.")
    assert replaced
    assert content == L3_TEMPLATE


def test_l3_stream_releases_clean_text_up_to_word_boundaries() -> None:
    stream = L3Stream()
    assert stream.feed("Halo ") == "Halo "
    assert stream.feed("apa kab") == "apa "
    assert stream.feed("ar?") == "kabar?"
    assert stream.finish("Halo apa kabar?") == ("Halo apa kabar?", False)


async def test_l2_timeout_is_elevated_never_normal() -> None:
    models = Models(Settings(_env_file=None, LOCAL_SAFETY_DELAY_MS=500))
    verdict = await SafetyClassifier(models, timeout_ms=50).classify("halo")
    assert verdict.level == RiskLevel.ELEVATED
    assert verdict.timed_out
    assert verdict.signals == ["l2:timeout"]


async def test_l2_local_classifier_levels() -> None:
    classifier = SafetyClassifier(Models(Settings(_env_file=None)), timeout_ms=3000)
    assert (await classifier.classify("aku ingin mati")).level == RiskLevel.CRISIS
    assert (await classifier.classify("aku putus asa")).level == RiskLevel.ELEVATED
    assert (await classifier.classify("atasan galak")).level == RiskLevel.NORMAL
