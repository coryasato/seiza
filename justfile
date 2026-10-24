# seiza: one module per app (and per component with a host of its own). `just --list --list-submodules` shows every recipe.

mod tycho 'apps/tycho/justfile'
mod observatory 'apps/observatory/justfile'
mod tall-table 'components/tall-table/justfile'

default:
    @just --list --list-submodules

# Install JS dependencies for every app host.
setup:
    npm install
