-- Adds the bilingual beta terms as a new DRAFT consent version.
-- Does not modify or approve existing consent versions.
DO $$
DECLARE
  new_body jsonb := $content$
{
  "type": "service",
  "title": "Ketentuan DeepTalk AI",
  "summary": [
    "DeepTalk AI adalah program komputer (AI), bukan psikolog, dan tidak memberi diagnosis atau saran obat.",
    "DeepTalk AI masih dalam masa beta/trial. Ketentuan ini bersifat sementara dan berlaku bagi pengguna selama masa beta/trial; naskah legal final akan dipublikasikan saat versi rilis resmi tersedia.",
    "Pada versi beta, datamu disimpan terenkripsi di Singapura. Pada versi production atau rilis resmi, datamu disimpan terenkripsi di Indonesia. Untuk membalas, pesanmu diproses di Amerika Serikat melalui Gemini Enterprise Agent Platform (Vertex AI) milik Google Cloud.",
    "Bila terdeteksi tanda bahaya, DeepTalk AI menampilkan kontak bantuan darurat.",
    "Kamu bisa menghapus riwayat dan mencabut persetujuan kapan saja di Persetujuan & data."
  ],
  "body": "[DRAFT — belum ditinjau hukum]\n\nDeepTalk AI saat ini masih dalam masa beta/trial. Ketentuan ini bersifat sementara dan berlaku bagi pengguna yang mengikuti beta/trial. Tim hukum dan tim terkait sedang menyusun naskah legal final yang akan dipublikasikan saat versi rilis resmi tersedia.\n\nNaskah final akan menjelaskan data yang diproses, tujuan pemrosesan, penyedia model (Google Cloud Gemini Enterprise Agent Platform / Vertex AI), lokasi penyimpanan data (Singapura selama beta/trial; Indonesia pada versi production atau rilis resmi), lokasi pemrosesan AI (Amerika Serikat) beserta dasar transfer ke luar negeri (UU PDP Pasal 56), masa simpan (Q10), hak pengguna menurut UU PDP, dan cara menghubungi DeepTalk.",
  "translations": {
    "en": {
      "title": "DeepTalk AI Terms",
      "summary": [
        "DeepTalk AI is an artificial intelligence (AI) computer program, not a psychologist. It does not provide diagnoses or medication advice.",
        "DeepTalk AI is currently in beta/trial. These temporary terms apply to users during the beta/trial; the final legal terms will be published when the official release is available.",
        "During the beta, your data is stored in encrypted form in Singapore. For the production or official release, your data will be stored in encrypted form in Indonesia. To generate replies, your messages are processed in the United States through Google Cloud's Gemini Enterprise Agent Platform (Vertex AI).",
        "If signs of danger are detected, DeepTalk AI displays emergency help contacts.",
        "You can delete your history and withdraw your consent at any time in Consent & data."
      ],
      "body": "[DRAFT — NOT REVIEWED BY LEGAL]\n\nDeepTalk AI is currently in beta/trial. These terms are temporary and apply to users participating in the beta/trial. Our legal and relevant teams are preparing the final legal terms, which will be published when the official release is available.\n\nThe final terms will explain the data processed and purposes, the model provider (Google Cloud Gemini Enterprise Agent Platform / Vertex AI), data storage locations (Singapore during beta/trial; Indonesia for the production or official release), AI processing in the United States and the legal basis for international transfers (Article 56 of Indonesia's Personal Data Protection Law), retention period (Q10), your rights under that law, and how to contact DeepTalk."
    }
  },
  "min_accepted_version": 1
}
$content$::jsonb;
  existing_body jsonb;
BEGIN
  SELECT body
    INTO existing_body
    FROM ai_content_versions
   WHERE kind = 'consent_text'
     AND ref_id = 'service'
     AND version = 7
   FOR UPDATE;

  IF FOUND THEN
    IF existing_body IS DISTINCT FROM new_body THEN
      RAISE EXCEPTION 'consent_text/service v7 exists with different content; use a new version';
    END IF;
    RAISE NOTICE 'consent_text/service v7 already exists unchanged';
  ELSE
    INSERT INTO ai_content_versions (id, kind, ref_id, version, body, status, author_id)
    VALUES (
      gen_random_uuid(),
      'consent_text',
      'service',
      7,
      new_body,
      'draft',
      'seed:content'
    );
    RAISE NOTICE 'Inserted consent_text/service v7 as draft';
  END IF;
END
$$;
