'use server';

export type PublishResult = { ok: true; message: string; stamp: string } | { ok: false; error: string };

export async function twPublishAction(input: { entryId: number; everyone: boolean }): Promise<PublishResult> {
  void input;
  return { ok: false, error: 'Publishing isn’t ready yet.' };
}
