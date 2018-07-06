import { CollectionData } from '../models/data/collectionData';

import { Collection } from '../models/domain/collection';

import { CollectionView } from '../models/view/collectionView';

export abstract class CollectionService {
    decryptedCollectionCache: CollectionView[];

    clearCache: () => void;
    encrypt: (model: CollectionView) => Promise<Collection>;
    get: (id: string) => Promise<Collection>;
    getAll: () => Promise<Collection[]>;
    getAllDecrypted: () => Promise<CollectionView[]>;
    upsert: (collection: CollectionData | CollectionData[]) => Promise<any>;
    replace: (collections: { [id: string]: CollectionData; }) => Promise<any>;
    clear: (userId: string) => Promise<any>;
    delete: (id: string | string[]) => Promise<any>;
    getLocaleSortingFunction: () => (a: CollectionView, b: CollectionView) => number;
}
