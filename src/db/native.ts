import { requireNativeModule } from 'expo';

import { splitSql } from './sqlSplit';

/**
 * 앱의 DB. expo-sqlite 가 아니라 Kotlin 모듈(FlowDb)을 거쳐, 비서 제공자와 **같은 SQLite 연결 하나**를 쓴다.
 * (같은 프로세스에서 SQLite 라이브러리 둘이 한 파일을 열면 "database disk image is malformed" 로 손상된다)
 * 공개 API 는 expo-sqlite 와 같은 모양이다: execAsync / runAsync / getAllAsync / getFirstAsync /
 * withTransactionAsync / withExclusiveTransactionAsync.
 *
 * 트랜잭션 콜백 안에서는 반드시 콜백이 받은 `tx` 로만 질의해야 한다 (바깥 db 로 부르면 트랜잭션이 끝날 때까지 기다리게 된다).
 */
export type BindValue = string | number | boolean | null;
export type BindParams = BindValue[];
export type RunResult = { changes: number; lastInsertRowId: number };

interface Native {
  open(): Promise<{ recovered: string | null }>;
  exec(sql: string): Promise<void>;
  run(sql: string, params: BindValue[]): Promise<RunResult>;
  getAll(sql: string, params: BindValue[]): Promise<Record<string, unknown>[]>;
  txBegin(): Promise<string>;
  txExec(token: string, sql: string): Promise<void>;
  txRun(token: string, sql: string, params: BindValue[]): Promise<RunResult>;
  txGetAll(token: string, sql: string, params: BindValue[]): Promise<Record<string, unknown>[]>;
  txEnd(token: string, commit: boolean): Promise<void>;
  listCorrupt(): Promise<{ name: string; bytes: number }[]>;
  deleteCorrupt(name: string): Promise<boolean>;
}

let nativeModule: Native | null = null;
const native = (): Native => (nativeModule ??= requireNativeModule<Native>('FlowDb'));

/** `runAsync(sql, a, b)` 와 `runAsync(sql, [a, b])` 둘 다 받는다 */
const flat = (params: unknown[]): BindValue[] => (params.length === 1 && Array.isArray(params[0]) ? (params[0] as BindValue[]) : (params as BindValue[]));

/** 트랜잭션 안에서 쓰는 질의 인터페이스 */
export interface Queryable {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<RunResult>;
  getAllAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
}

class Tx implements Queryable {
  constructor(private readonly token: string) {}
  async execAsync(sql: string) {
    for (const s of splitSql(sql)) await native().txExec(this.token, s);
  }
  runAsync(sql: string, ...params: unknown[]) {
    return native().txRun(this.token, sql, flat(params));
  }
  async getAllAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return (await native().txGetAll(this.token, sql, flat(params))) as T[];
  }
  async getFirstAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return ((await native().txGetAll(this.token, sql, flat(params)))[0] ?? null) as T | null;
  }
}

export class NativeDatabase implements Queryable {
  /** 시작할 때 손상된 DB 를 치우고 새로 만들었다면 보존된 파일 이름 */
  recovered: string | null = null;

  async open(): Promise<void> {
    this.recovered = (await native().open()).recovered;
  }

  async execAsync(sql: string) {
    for (const s of splitSql(sql)) await native().exec(s);
  }
  runAsync(sql: string, ...params: unknown[]) {
    return native().run(sql, flat(params));
  }
  async getAllAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return (await native().getAll(sql, flat(params))) as T[];
  }
  async getFirstAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return ((await native().getAll(sql, flat(params)))[0] ?? null) as T | null;
  }

  /** BEGIN IMMEDIATE … COMMIT. 콜백이 던지면 ROLLBACK 하고 그대로 다시 던진다 */
  async withExclusiveTransactionAsync<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const token = await native().txBegin();
    let result: T;
    try {
      result = await fn(new Tx(token));
    } catch (e) {
      await native().txEnd(token, false).catch(() => {});
      throw e;
    }
    await native().txEnd(token, true);
    return result;
  }
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    return this.withExclusiveTransactionAsync(() => fn());
  }

  listCorrupt() {
    return native().listCorrupt();
  }
  deleteCorrupt(name: string) {
    return native().deleteCorrupt(name);
  }
}

/** 기존 코드가 쓰던 이름 (expo-sqlite 의 SQLiteDatabase) */
export type SQLiteDatabase = NativeDatabase;
