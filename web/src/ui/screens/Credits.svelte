<script lang="ts">
  /** Static credits and licences. */
  const version = __APP_VERSION__;
</script>

<div class="credits">
  <p class="lead">Idyll Lives is a life simulation built for the browser, with performance first.</p>
  <dl>
    <dt>Simulation</dt>
    <dd>Rust compiled to WebAssembly, running in a Web Worker</dd>
    <dt>Rendering</dt>
    <dd>Babylon.js (Apache-2.0) on WebGPU, with a WebGL2 fallback</dd>
    <dt>Interface</dt>
    <dd>Svelte 5 (MIT) and plain CSS</dd>
    <dt>Typeface</dt>
    <dd>Inter by Rasmus Andersson (SIL Open Font License)</dd>
    <dt>Art</dt>
    <dd>Models, textures and animations from Poly Haven, ambientCG, Kenney and Quaternius (all CC0), plus geometry and icons made for this project; all art is replaceable through the asset manifest</dd>
    <dt>Licence</dt>
    <dd>Code under the MIT licence; third-party art keeps its own licence (CC0)</dd>
  </dl>
  <p class="small">Version {version}</p>
</div>

<style>
  .lead {
    margin: 0 0 16px;
    font-size: 15px;
    line-height: 1.5;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px 24px;
    margin: 0;
  }
  dt {
    font-weight: 650;
  }
  dd {
    margin: 0;
    color: var(--text-muted);
  }
  .small {
    margin: 20px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
