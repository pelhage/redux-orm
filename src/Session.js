import partition from 'lodash/collection/partition';

/**
 * Session handles a single
 * action dispatch.
 */
const Session = class Session {
    /**
     * Creates a new Session.
     *
     * @param  {Schema} schema - a Schema instance
     * @param  {Object} state - the database state
     * @param  {Object} [action] - the current action in the dispatch cycle.
     *                             Will be passed to the user defined reducers.
     * @param  {Boolean} withMutations - whether the session should mutate data
     */
    constructor(models, state, action, withMutations) {
        this.models = models;
        this.state = state;
        this.action = action;
        this.withMutations = !!withMutations;

        this.updates = [];

        this._accessedModels = {};
        this.modelData = {};

        models.forEach(modelClass => {
            Object.defineProperty(this, modelClass.modelName, {
                get: () => modelClass,
            });

            modelClass.connect(this);
        });
    }

    markAccessed(model) {
        this.getDataForModel(model.modelName).accessed = true;
    }

    get accessedModels() {
        return this.models.filter(model => {
            return !!this.getDataForModel(model.modelName).accessed;
        }).map(model => model.modelName);
    }

    getDataForModel(modelName) {
        if (!this.modelData[modelName]) {
            this.modelData[modelName] = {};
        }

        return this.modelData[modelName];
    }

    /**
     * Records an update to the session.
     * @param {Object} update - the update object. Must have keys
     *                          `type`, `payload` and `meta`. `meta`
     *                          must also include a `name` attribute
     *                          that contains the model name.
     */
    addUpdate(update) {
        if (this.withMutations) {
            const modelName = update.meta.name;
            const modelState = this.getState(modelName);
            const state = modelState || this[modelName].getDefaultState();

            // The backend used in the updateReducer
            // will mutate the model state.
            this[modelName].updateReducer(state, update);
        } else {
            this.updates.push(update);
        }
    }

    /**
     * Gets the recorded updates for `modelClass` and
     * deletes them from the Session instance updates list.
     *
     * @param  {Model} modelClass - the model class to get updates for
     * @return {Object[]} A list of the user-recorded updates for `modelClass`.
     */
    getUpdatesFor(modelClass) {
        const [updates, other] = partition(
            this.updates,
            'meta.name',
            modelClass.modelName);

        this.updates = other;
        return updates;
    }

    getState(modelName) {
        if (this.state) {
            return this.state[modelName];
        }
        return undefined;
    }

    /**
     * Calls the user defined reducers and returns
     * the next state.
     * If the session uses mutations, just returns the state.
     *
     * @return {Object} The next state
     */
    reduce() {
        if (this.withMutations) return this.state;

        const prevState = this.state;
        const action = this.action;

        const nextState = this.models.reduce((_nextState, modelClass) => {
            const modelState = this.getState(modelClass.modelName);
            let nextModelState = modelClass.reducer(modelState, action, modelClass, this);

            if (typeof nextModelState === 'undefined') {
                // If nothing was returned from the reducer,
                // use the return value of getNextState.
                nextModelState = modelClass.getNextState();
            }

            if (nextModelState !== prevState[modelClass.modelName]) {
                if (_nextState === prevState) {
                    // We know that something has changed, so we cannot
                    // return the previous state. Switching this reduce function
                    // to use a shallowcopied version of the previous state.
                    const prevStateCopied = Object.assign({}, prevState);
                    prevStateCopied[modelClass.modelName] = nextModelState;
                    return prevStateCopied;
                }

                _nextState[modelClass.modelName] = nextModelState;
            }

            return _nextState;
        }, prevState);

        // The remaining updates are for M2M tables.
        let finalState = nextState;

        if (this.updates.length > 0) {
            if (finalState === prevState) {
                // If we're still working with the previous state,
                // shallow copy it since we have updates for sure now.
                finalState = Object.assign({}, prevState);
            }

            finalState = this.updates.reduce((state, update) => {
                const modelName = update.meta.name;
                state[modelName] = this[modelName].getNextState();
                return state;
            }, finalState);
        } else {
            finalState = nextState;
        }

        this.updates = [];

        return finalState;
    }
};

export default Session;