import type {
  ContextAttachments,
  ContextDocUsage,
  SpecFile,
  SpecFileList,
} from '@devdigest/shared';
import { MAX_ATTACHMENTS, MAX_DOC_BYTES, MAX_DOCS } from './constants.js';
import { ContextDomainError, mergeAttachments } from './domain.js';
import { docTokens, readState, toSpecFile } from './helpers.js';
import { validateDocPath } from './paths.js';
import type { AttachmentStore, DocSource, TokenCounter } from './ports.js';
import type { ContextFacade, ContextOwnerRef } from './types.js';

export interface ContextDeps {
  store: AttachmentStore;
  docs: DocSource;
  tokens: TokenCounter;
}

function assertPath(path: string): void {
  const check = validateDocPath(path);
  if (!check.ok) {
    throw new ContextDomainError('invalid_path', `Invalid document path (${check.reason})`);
  }
}

/** Project Context use cases: list/read repo docs and manage agent/skill attachments. */
export class ContextService implements ContextFacade {
  constructor(private readonly deps: ContextDeps) {}

  private async repoRoot(ws: string, repoId: string): Promise<string> {
    const repo = await this.deps.store.findRepo(ws, repoId);
    if (!repo) throw new ContextDomainError('repo_not_found', 'Repo not found');
    return this.requireClone(repo.clonePath);
  }

  private async requireClone(clonePath: string | null): Promise<string> {
    if (!clonePath || !(await this.deps.docs.isClone(clonePath))) {
      throw new ContextDomainError('repo_not_cloned', 'Repository is not cloned');
    }
    return clonePath;
  }

  private async assertRepo(ws: string, repoId: string) {
    const repo = await this.deps.store.findRepo(ws, repoId);
    if (!repo) throw new ContextDomainError('repo_not_found', 'Repo not found');
    return repo;
  }

  private async assertOwner(ws: string, owner: ContextOwnerRef): Promise<void> {
    if (!(await this.deps.store.ownerExists(ws, owner))) {
      throw new ContextDomainError(`${owner.kind}_not_found`, `${owner.kind} not found`);
    }
  }

  async list(ws: string, repoId: string): Promise<SpecFileList> {
    const root = await this.repoRoot(ws, repoId);
    const scanned = await this.deps.docs.list(root);
    const docs: SpecFile[] = [];
    for (const doc of scanned.slice(0, MAX_DOCS)) {
      if (doc.size > MAX_DOC_BYTES) {
        docs.push(toSpecFile(doc, 'too_large', null));
        continue;
      }
      const read = await this.deps.docs.read(root, doc.path);
      if (read.kind === 'ok') {
        docs.push(toSpecFile(doc, 'ok', docTokens(this.deps.tokens, doc.path, read.content)));
      } else if (read.kind === 'too_large') {
        docs.push(toSpecFile(doc, 'too_large', null));
      }
    }
    return { docs, truncated: scanned.length > MAX_DOCS };
  }

  async file(ws: string, repoId: string, path: string): Promise<SpecFile> {
    await this.assertRepo(ws, repoId);
    assertPath(path);
    const root = await this.repoRoot(ws, repoId);
    const read = await this.deps.docs.read(root, path);
    if (read.kind === 'outside') {
      throw new ContextDomainError('invalid_path', 'Invalid document path (outside_clone)');
    }
    if (read.kind !== 'ok') throw new ContextDomainError('doc_not_found', 'Document not found');
    return {
      ...toSpecFile({ path, size: read.size, mtime: null }, 'ok', docTokens(this.deps.tokens, path, read.content)),
      updated_at: undefined,
      content: read.content,
    };
  }

  async usage(ws: string, repoId: string, path: string): Promise<ContextDocUsage> {
    await this.assertRepo(ws, repoId);
    assertPath(path);
    return this.deps.store.usage(ws, repoId, path);
  }

  async getAttachments(
    ws: string,
    owner: ContextOwnerRef,
    repoId: string,
  ): Promise<ContextAttachments> {
    await this.assertRepo(ws, repoId);
    await this.assertOwner(ws, owner);
    const root = await this.repoRoot(ws, repoId);
    return this.build(root, owner, repoId);
  }

  async setAttachments(
    ws: string,
    owner: ContextOwnerRef,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachments> {
    await this.assertRepo(ws, repoId);
    await this.assertOwner(ws, owner);
    if (paths.length > MAX_ATTACHMENTS) {
      throw new ContextDomainError('invalid_path', `At most ${MAX_ATTACHMENTS} documents`);
    }
    for (const p of paths) assertPath(p);
    if (new Set(paths).size !== paths.length) {
      throw new ContextDomainError('invalid_path', 'Duplicate document path');
    }
    const root = await this.repoRoot(ws, repoId);
    await this.deps.store.replace(ws, owner, repoId, paths);
    return this.build(root, owner, repoId);
  }

  private async build(
    root: string,
    owner: ContextOwnerRef,
    repoId: string,
  ): Promise<ContextAttachments> {
    const { store, docs, tokens } = this.deps;
    const state = async (path: string) => readState(tokens, path, await docs.read(root, path));

    const own = await store.listOwn(owner, repoId);
    const attached = [];
    for (const path of own) attached.push({ path, ...(await state(path)) });

    const inherited = [];
    if (owner.kind === 'agent') {
      const run = await store.loadForRun(owner.id, repoId);
      for (const doc of mergeAttachments({ ...run, own })) {
        if (!doc.via) continue;
        inherited.push({
          path: doc.path,
          skill_id: doc.via.skillId,
          skill_name: doc.via.skillName,
          ...(await state(doc.path)),
        });
      }
    }
    return { repo_id: repoId, attached, inherited };
  }
}
