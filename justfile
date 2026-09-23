# seiza: one module per app. `just --list --list-submodules` shows every recipe.

mod tycho 'apps/tycho/justfile'

default:
    @just --list --list-submodules

# Install JS dependencies for every app host.
setup:
    npm install
