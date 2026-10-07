# ADR-0005: Arquivos no Cloudflare R2 com quarentena

- **Status:** Aceito
- **Data:** 2026-10-07

## Contexto

Anexos de projeto, portfólio e entregas são uploads não confiáveis.

## Decisão

**Cloudflare R2** (API S3) com URL pré-assinada para upload direto em um bucket de **quarentena**. Um job valida magic bytes, tamanho e antivírus (ClamAV) e promove o arquivo ao bucket privado. Download só por URL assinada de curta duração.

## Alternativas descartadas

**S3**: egress caro. **Supabase Storage**: acopla ao provedor de banco.

## Consequências

Porta `ObjectStorage` com adapter S3-compatível. MinIO no ambiente local.
