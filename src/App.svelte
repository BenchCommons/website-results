<script>
  import Nav from './components/Nav.svelte';
  import { followRound, loadIndex, loadRound } from './lib/data.js';
  import { decode, encode } from './lib/hash.js';
  import Environment from './sections/Environment.svelte';
  import Intro from './sections/Intro.svelte';
  import Quality from './sections/Quality.svelte';
  import Results from './sections/Results.svelte';
  import Rounds from './sections/Rounds.svelte';

  let index = $state(null);
  let round = $state(null);
  let ui = $state(null);
  let error = $state(null);
  // The failure of one round. It only applies while that round is the selected one.
  let roundError = $state(null);
  let indexTry = $state(0);
  let roundTry = $state(0);
  let retrying = $state(false);

  const entry = $derived(index && ui ? index.rounds.find((r) => r.id === ui.round) : null);
  const failed = $derived(roundError && ui && roundError.id === ui.round ? roundError.message : null);
  const suites = $derived(entry?.suites ?? []);

  /** Applies a ui change and mirrors it in the hash; section changes add a history entry. */
  function set(patch) {
    const next = { ...ui, ...patch };
    const hash = encode(next, round && round.id === next.round ? round : null);
    if (patch.section && patch.section !== ui.section) location.hash = hash;
    else history.replaceState(null, '', hash);
    ui = decode(hash, index, round && round.id === next.round ? round : null);
  }

  function onround(id) {
    set({ round: id, suite: null, cell: null, compare: null });
  }

  $effect(() => {
    const onhash = () => index && (ui = decode(location.hash, index, round));
    addEventListener('hashchange', onhash);
    return () => removeEventListener('hashchange', onhash);
  });

  $effect(() => {
    indexTry; // a retry reruns the load
    loadIndex()
      .then((i) => {
        error = null;
        index = i;
        ui = decode(location.hash, i, null);
      })
      .catch((e) => (error = e.message));
  });

  $effect(() => {
    const id = ui?.round;
    if (!id) return;
    roundTry; // a retry reruns the load
    if (round?.id === id) return;
    return followRound(
      id,
      loadRound,
      (r) => {
        roundError = null;
        retrying = false;
        round = r;
        ui = decode(location.hash.includes('round=') ? location.hash : encode(ui, null), index, r);
      },
      (e) => {
        roundError = { id, message: e.message };
        retrying = false;
      },
    );
  });

  $effect(() => {
    if (ui) document.title = `${ui.section === 'intro' ? 'BenchCommons' : `BenchCommons · ${ui.section} · ${ui.round}`}`;
  });
</script>

{#if error}
  <main>
    <p class="card" role="alert">Could not load the results: {error}</p>
    <p><button type="button" onclick={() => { error = null; indexTry++; }}>Retry</button></p>
  </main>
{:else if !index || !ui}
  <main><p class="muted">Loading results…</p></main>
{:else}
  <Nav {index} {ui} {round} {onround} />
  <main id="main">
    {#if ui.section === 'intro'}
      <Intro {entry} />
    {:else if failed}
      <p class="card" role="alert">Could not load round {ui.round}: {failed}</p>
      <p><button type="button" disabled={retrying} onclick={() => { retrying = true; roundTry++; }}>Retry</button></p>
    {:else if !round || round.id !== ui.round}
      <p class="muted">Loading round {ui.round}…</p>
    {:else if ui.section === 'environment'}
      <Environment {round} {entry} {suites} />
    {:else if ui.section === 'results'}
      <Results {round} {ui} {suites} {set} />
    {:else if ui.section === 'quality'}
      <Quality {round} {ui} {set} />
    {:else if ui.section === 'rounds'}
      <Rounds {index} {round} {ui} {set} />
    {/if}
  </main>
{/if}
