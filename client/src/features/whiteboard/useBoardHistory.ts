import { useCallback, useRef, useState } from 'react';
import type { Classroom } from '../../hooks/useClassroom';
import type { BoardObject, NewObject } from '../../types';

type Entry =
  | { t: 'add'; obj: NewObject }
  | { t: 'remove'; objs: NewObject[] }
  | { t: 'update'; id: string; before: Partial<BoardObject>; after: Partial<BoardObject> };

const strip = ({ author, z, ts, ...rest }: BoardObject): NewObject => rest;

/** Per-user undo/redo. Each undo is replayed through the server, so permissions still apply. */
export function useBoardHistory(cl: Classroom) {
  const undoStack = useRef<Entry[]>([]);
  const redoStack = useRef<Entry[]>([]);
  const [, bump] = useState(0);
  const push = (e: Entry) => { undoStack.current.push(e); if (undoStack.current.length > 100) undoStack.current.shift(); redoStack.current = []; bump((n) => n + 1); };

  const add = useCallback((obj: NewObject) => { void cl.addObject(obj); push({ t: 'add', obj }); }, [cl.addObject]);
  const remove = useCallback((ids: string[]) => {
    const objs = cl.objects.filter((o) => ids.includes(o.id)).map(strip);
    if (!objs.length) return; void cl.removeObjects(ids); push({ t: 'remove', objs });
  }, [cl.objects, cl.removeObjects]);
  const recordUpdate = useCallback((id: string, before: Partial<BoardObject>, after: Partial<BoardObject>) => push({ t: 'update', id, before, after }), []);

  const apply = async (e: Entry, inverse: boolean): Promise<void> => {
    if (e.t === 'add') { if (inverse) await cl.removeObjects([e.obj.id]); else await cl.addObject(e.obj); }
    else if (e.t === 'remove') { if (inverse) for (const o of e.objs) await cl.addObject(o); else await cl.removeObjects(e.objs.map((o) => o.id)); }
    else cl.updateObject(e.id, inverse ? e.before : e.after, true);
  };
  const undo = useCallback(async () => {
    const e = undoStack.current.pop(); if (!e) return;
    redoStack.current.push(e); bump((n) => n + 1); await apply(e, true);
  }, [cl]);
  const redo = useCallback(async () => {
    const e = redoStack.current.pop(); if (!e) return;
    undoStack.current.push(e); bump((n) => n + 1); await apply(e, false);
  }, [cl]);
  return { add, remove, recordUpdate, undo, redo, canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 };
}
export type BoardHistory = ReturnType<typeof useBoardHistory>;
