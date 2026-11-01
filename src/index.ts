/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sfx } from './audio.js';
import { CreatureSystem } from './creature-system.js';
import { ShadowSystem } from './shadow-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(ShadowSystem);
  world.registerSystem(CreatureSystem);
  setupLanding(world);
});

/** The page before entering mixed reality: one button, then hands only. */
function setupLanding(world: World): void {
  const landing = document.getElementById('landing')!;
  const start = document.getElementById('start') as HTMLButtonElement;
  const desktop = document.getElementById('desktop') as HTMLButtonElement;
  const note = document.getElementById('note')!;
  const help = document.getElementById('desktop-help')!;

  const showLanding = (show: boolean) => {
    landing.classList.toggle('hidden', !show);
    help.style.display = show || world.session ? 'none' : 'block';
  };

  void (navigator.xr?.isSessionSupported('immersive-ar') ?? Promise.resolve(false))
    .catch(() => false)
    .then((supported) => {
      if (supported) return;
      start.hidden = true;
      desktop.textContent = 'Preview in this browser';
      note.textContent = 'Open this page in the Meta Quest browser to play in your room.';
    });

  start.addEventListener('click', () => {
    sfx.unlock();
    world.launchXR();
  });
  desktop.addEventListener('click', () => {
    sfx.unlock();
    showLanding(false);
  });
  // Any tap also wakes audio (browsers require a gesture).
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  const xr = world.renderer.xr;
  xr.addEventListener('sessionstart', () => {
    sfx.unlock();
    showLanding(false);
  });
  xr.addEventListener('sessionend', () => showLanding(true));
}
