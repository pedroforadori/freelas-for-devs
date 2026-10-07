import { redirect } from 'next/navigation';

/** A plataforma começa no painel; sem sessão, o guarda leva ao login. */
export default function Home() {
  redirect('/painel');
}
