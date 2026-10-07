/**
 * Valor monetário em centavos inteiros (nunca float). Moeda única no MVP: BRL.
 * Percentuais são expressos em basis points (1% = 100 bps) para evitar arredondamento ambíguo.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static ofCents(cents: number): Money {
    if (!Number.isSafeInteger(cents)) throw new RangeError(`Valor em centavos inválido: ${cents}`);
    if (cents < 0) throw new RangeError('Valor monetário não pode ser negativo.');
    return new Money(cents);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return Money.ofCents(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return Money.ofCents(this.cents - other.cents);
  }

  /** Percentual em basis points, arredondado meio-para-cima ao centavo. */
  percentage(bps: number): Money {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new RangeError(`Percentual inválido: ${bps} bps`);
    }
    return Money.ofCents(Math.round((this.cents * bps) / 10_000));
  }

  /**
   * Divide o valor proporcionalmente aos pesos sem perder centavos:
   * o resto é distribuído, um centavo por vez, a partir da primeira parte.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0 || weights.some((w) => !Number.isInteger(w) || w < 0)) {
      throw new RangeError('Pesos devem ser inteiros não negativos.');
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) throw new RangeError('A soma dos pesos deve ser positiva.');

    const parts = weights.map((w) => Math.floor((this.cents * w) / total));
    let remainder = this.cents - parts.reduce((sum, p) => sum + p, 0);
    for (let i = 0; remainder > 0; i = (i + 1) % parts.length) {
      if (weights[i] === 0) continue;
      parts[i] = (parts[i] ?? 0) + 1;
      remainder -= 1;
    }
    return parts.map((cents) => Money.ofCents(cents));
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  isGreaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  toJSON(): number {
    return this.cents;
  }
}
