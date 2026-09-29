export type Identifier = string;

export interface Dot {
  readonly x: number;
  readonly y: number;
}

export interface Performer {
  readonly id: Identifier;
  readonly rankCode: string;
  readonly displayName: string;
  readonly section?: string;
  readonly notes?: string;
}

export interface SetPage {
  readonly id: Identifier;
  readonly name: string;
  readonly startCount: number;
  readonly positions: Readonly<Record<Identifier, Dot>>;
}

export interface FtlDefinition {
  readonly leaderId: Identifier;
  readonly followerIds: readonly Identifier[];
  readonly offsetUnits: Readonly<Record<Identifier, number>>;
  readonly distanceUnits: number;
  readonly path: readonly Dot[];
  readonly expectedEndPositions?: Readonly<Record<Identifier, Dot>>;
}

export interface Transition {
  readonly id: Identifier;
  readonly fromSetId: Identifier;
  readonly toSetId: Identifier;
  readonly counts: number;
  readonly mode: 'float' | 'ftl';
  readonly ftl?: FtlDefinition;
  readonly notes?: string;
}

export interface FreeformDocument {
  readonly format: 'freeform';
  readonly formatVersion: '1.0.0';
  readonly show: Readonly<{
    id: Identifier;
    title: string;
    totalCounts: number;
    createdAt?: string;
    updatedAt?: string;
  }>;
  readonly field: Readonly<{
    preset: 'NFHS_11_PLAYER';
    unitsPerYard: 2880;
    lengthUnits: 288000;
    widthUnits: 153600;
    frontHashY: 51200;
    backHashY: 102400;
  }>;
  readonly settings: Readonly<{ collisionThresholdUnits: number }>;
  readonly performers: readonly Performer[];
  readonly sets: readonly SetPage[];
  readonly transitions: readonly Transition[];
  readonly annotations: readonly unknown[];
  readonly symbols?: readonly unknown[];
  readonly layers?: readonly unknown[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface DocumentState {
  readonly document: FreeformDocument;
  readonly revision: number;
}

export type DocumentCommand =
  | { readonly type: 'show.title.set'; readonly title: string }
  | { readonly type: 'show.total-counts.set'; readonly totalCounts: number }
  | { readonly type: 'document.replace'; readonly document: FreeformDocument };

export interface CommandStore {
  getState(): DocumentState;
  apply(command: DocumentCommand): DocumentState;
  undo(): DocumentState | undefined;
  redo(): DocumentState | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoCommands(): readonly DocumentCommand[];
}
