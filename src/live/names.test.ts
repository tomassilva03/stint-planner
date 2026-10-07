import { describe, expect, it } from 'vitest';
import type { Driver } from '../model';
import { displayName, matchDriver } from './names';

const d = (name: string) => ({ id: name, name }) as Driver;
const drivers = [d('Tomás Silva'), d('Luís Cunha'), d('Tiago Rodrigues')];

describe('names from iRacing', () => {
  it('repairs a broken accent from the plan', () => {
    expect(displayName('Tom�s Silva4', drivers)).toBe('Tomás Silva');
    expect(matchDriver('Lu�s Cunha', drivers)?.name).toBe('Luís Cunha');
  });
  it('matches plain names, ignoring case, accents and iRacing digits', () => {
    expect(displayName('Tiago Rodrigues', drivers)).toBe('Tiago Rodrigues');
    expect(displayName('tomas silva2', drivers)).toBe('Tomás Silva');
  });
  it('keeps unknown names readable', () => {
    expect(displayName('Jo�o Pereira', drivers)).toBe('Jo?o Pereira');
    expect(displayName('Someone Else', drivers)).toBe('Someone Else');
  });
  it('does not let a broken letter match a different name', () => {
    expect(matchDriver('Tom�s Silvb', drivers)).toBeUndefined();
  });
});
