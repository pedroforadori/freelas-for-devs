import { ImageResponse } from 'next/og';

export const alt = 'Freelas 4 Devs — seu projeto de software com o dev certo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Imagem de compartilhamento (redes sociais) gerada no build, no visual do site. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#191a23',
        padding: 72,
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', fontSize: 40, fontWeight: 600 }}>Freelas 4 Devs</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            alignSelf: 'flex-start',
            background: '#b9ff66',
            color: '#191a23',
            borderRadius: 14,
            padding: '6px 18px',
            fontSize: 64,
            fontWeight: 600,
          }}
        >
          Seu projeto de software
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 600 }}>com o dev certo.</div>
        <div style={{ display: 'flex', fontSize: 30, color: '#d6d6d6', marginTop: 12 }}>
          Estimativa na hora · escopo fechado · pagamento protegido
        </div>
      </div>
    </div>,
    size,
  );
}
