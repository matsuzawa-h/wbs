import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { AppDb } from '../db';
import { OrganizationsService } from './organizations.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

function makeDb(): { db: AppDb; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (s) sqlite.exec(s);
    }
  }
  const db = drizzle(sqlite, { schema }) as unknown as AppDb;
  return { db, close: () => sqlite.close() };
}

describe('OrganizationsService', () => {
  describe('CRUD と採番', () => {
    it('code を省略すると O### で連番採番される', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const a = svc.create({ name: '組織A' });
        const b = svc.create({ name: '組織B' });
        const c = svc.create({ name: '組織C', code: 'CUSTOM_X' });
        const d = svc.create({ name: '組織D' });
        expect(a.code).toBe('O001');
        expect(b.code).toBe('O002');
        expect(c.code).toBe('CUSTOM_X');
        // CUSTOM_X は O### にマッチしないので次は 003
        expect(d.code).toBe('O003');
      } finally {
        close();
      }
    });

    it('list は sortOrder → code → id 昇順で並ぶ', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const a = svc.create({ name: 'A', sortOrder: 10 });
        const b = svc.create({ name: 'B', sortOrder: 0 });
        const c = svc.create({ name: 'C', sortOrder: 0 });
        const list = svc.list();
        expect(list.map((o) => o.id)).toEqual([b.id, c.id, a.id]);
      } finally {
        close();
      }
    });

    it('update は code/name/parent/isActive/sortOrder/note を部分更新する', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const o = svc.create({ name: '元名', code: 'O100' });
        const updated = svc.update(o.id, {
          name: '改名',
          isActive: false,
          note: 'メモ',
        });
        expect(updated.name).toBe('改名');
        expect(updated.code).toBe('O100'); // code 未指定なので変更されない
        expect(updated.isActive).toBe(0);
        expect(updated.note).toBe('メモ');
      } finally {
        close();
      }
    });

    it('findById で存在しない id は NotFoundException', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        expect(() => svc.findById(999)).toThrow(NotFoundException);
      } finally {
        close();
      }
    });
  });

  describe('code の部分 UNIQUE（空コードは複数許容）', () => {
    it('同じ code は ConflictException で拒否', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        svc.create({ name: 'A', code: 'AA' });
        expect(() => svc.create({ name: 'B', code: 'AA' })).toThrow(
          ConflictException,
        );
      } finally {
        close();
      }
    });

    it('update で code を別の組織に重複させると拒否', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        svc.create({ name: 'A', code: 'AA' });
        const b = svc.create({ name: 'B', code: 'BB' });
        expect(() =>
          svc.update(b.id, { code: 'AA' }),
        ).toThrow(ConflictException);
      } finally {
        close();
      }
    });

    it('自分自身の code への更新は許容（変更なし）', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const a = svc.create({ name: 'A', code: 'AA' });
        const updated = svc.update(a.id, { code: 'AA' });
        expect(updated.code).toBe('AA');
      } finally {
        close();
      }
    });

    it('code を空文字で更新すると NULL になる（複数 NULL 許容）', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const a = svc.create({ name: 'A', code: 'AA' });
        const b = svc.create({ name: 'B', code: 'BB' });
        const a2 = svc.update(a.id, { code: '' });
        const b2 = svc.update(b.id, { code: '' });
        expect(a2.code).toBeNull();
        expect(b2.code).toBeNull();
      } finally {
        close();
      }
    });
  });

  describe('parentId と循環防止', () => {
    it('存在しない parentId を指定すると NotFoundException', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        expect(() => svc.create({ name: 'X', parentId: 9999 })).toThrow(
          NotFoundException,
        );
      } finally {
        close();
      }
    });

    it('自分自身を親にすると ConflictException', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const a = svc.create({ name: 'A' });
        expect(() =>
          svc.update(a.id, { parentId: a.id }),
        ).toThrow(ConflictException);
      } finally {
        close();
      }
    });

    it('子孫を親にしようとすると BadRequestException（循環）', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const parent = svc.create({ name: '親' });
        const child = svc.create({ name: '子', parentId: parent.id });
        const grandchild = svc.create({ name: '孫', parentId: child.id });
        // 親 ← 子 ← 孫 を、親.parent = 孫 にすると循環
        expect(() =>
          svc.update(parent.id, { parentId: grandchild.id }),
        ).toThrow(BadRequestException);
      } finally {
        close();
      }
    });

    it('parentId=null で最上位に戻せる', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const p = svc.create({ name: '親' });
        const c = svc.create({ name: '子', parentId: p.id });
        expect(c.parentId).toBe(p.id);
        const c2 = svc.update(c.id, { parentId: null });
        expect(c2.parentId).toBeNull();
      } finally {
        close();
      }
    });
  });

  describe('削除時の SET NULL カスケード', () => {
    it('組織削除で customers / projects / assignees の organization_id が NULL になる', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const org = svc.create({ name: 'SomeOrg' });

        // 各テーブルに org に紐づくレコードを 1 件ずつ作成
        db.insert(schema.customers)
          .values({ name: '顧客A', organizationId: org.id })
          .run();
        db.insert(schema.assignees)
          .values({ code: 'E999', name: '社員A', organizationId: org.id })
          .run();
        db.insert(schema.projects)
          .values({ name: '案件A', organizationId: org.id })
          .run();

        svc.remove(org.id);

        const c = db.select().from(schema.customers).all()[0];
        const a = db.select().from(schema.assignees).all()[0];
        const p = db.select().from(schema.projects).all()[0];
        expect(c.organizationId).toBeNull();
        expect(a.organizationId).toBeNull();
        expect(p.organizationId).toBeNull();
      } finally {
        close();
      }
    });

    it('親組織削除で子組織の parent_id が NULL になる（自己参照 SET NULL）', () => {
      const { db, close } = makeDb();
      try {
        const svc = new OrganizationsService(db);
        const parent = svc.create({ name: '親' });
        const child = svc.create({ name: '子', parentId: parent.id });
        svc.remove(parent.id);
        const c = db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, child.id))
          .get();
        expect(c?.parentId).toBeNull();
      } finally {
        close();
      }
    });
  });
});
