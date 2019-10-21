/**
 * Copyright 2019 Abstrium SAS
 *
 *  This file is part of Cells Sync.
 *
 *  Cells Sync is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Cells Sync is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with Cells Sync.  If not, see <https://www.gnu.org/licenses/>.
 */
import 'whatwg-fetch'
import path from 'path'
import buildUrl from './Url'

class TreeNode {
    constructor(name, loader, parent = null, onChange = null){
        this.loader = loader;
        this.loading = false;
        this.loaded = false;
        this.name = name;
        this.parent = parent;
        this.children = [];
        this.onChange = onChange;
        this.collapsed = true;
    }
    load(initialPath = undefined){
        if(this.name === TreeNode.CREATE_FOLDER){
            return Promise.resolve([]);
        }
        this.loading = true;
        this.loaded = false;
        this.notify();
        return this.loader.ls(this.name).then(children => {
            this.children = [];
            let nextChild;
            children.forEach(child => {
                if (child.Type === 'COLLECTION'){
                    const treeChild = this.appendChild(child.Path, child);
                    let compKey = child.Path;
                    if(compKey.length > 0 && compKey[0] !== "/"){
                        compKey = "/" + compKey
                    }
                    if(initialPath !== undefined && initialPath.indexOf(compKey) === 0 && initialPath !== compKey) {
                        nextChild = treeChild;
                    }
                }
            });
            if(this.getDepth() >= 1 && this.loader.allowCreate){
                // Append Create Child
                this.appendChild(TreeNode.CREATE_FOLDER);
            }
            this.loading = false;
            this.loaded = true;
            if(!this.parent || initialPath){
                this.collapsed = false;
            }
            if(nextChild) {
                nextChild.load(initialPath);
            }
            this.notify();
        }).catch(e => {
            console.error(e);
            this.loading = false;
            this.loaded = true;
            this.collapsed = true;
            this.notify();
        });
    }
    createChildFolder(newName){
        return this.loader.mkdir(this.name + '/' + newName).then(() => {
            return this.load();
        })
    }
    notify(){
        if(this.parent){
            this.parent.notify();
        }
        if(this.onChange){
            this.onChange();
        }
    }
    appendChild(name, child = null){
        const c = new TreeNode(name, this.loader, this);
        if(child && child.MetaStore && child.MetaStore['ws_label']) {
            c.label = child.MetaStore['ws_label'].replace(/"/g, '');
        }
        this.children.push(c);
        return c;
    }
    getPath(){
        return this.name;
    }
    getName() {
        return path.basename(this.name) || this.loader.rootLabel;
    }
    isLoaded(){
        return this.loaded;
    }
    isLoading(){
        return this.loading;
    }
    isCollapsed(){
        return this.collapsed;
    }
    setCollapsed(c){
        this.collapsed = c;
    }
    getChildren(){
        return this.children;
    }
    getDepth(){
        let d = 0;
        let crt = this;
        while (crt.parent){
            d++;
            crt = crt.parent;
        }
        return d;
    }
    walk(cb){
        cb(this);
        this.children.forEach(c => {
            c.walk(cb)
        });
    }
}

TreeNode.CREATE_FOLDER = "__CREATE_FOLDER__";

class Loader {
    constructor(rootLabel, uri, allowCreate, errorHandler) {
        this.rootLabel = rootLabel;
        this.uri = uri;
        this.allowCreate = allowCreate;
        if (!errorHandler) {
            this.errorHandler = (e) => {console.log(e, 'no error handler set')}
        } else {
            this.errorHandler = (e) => {
                if(!this.closed){
                    errorHandler(e);
                } else{
                    console.log(e, 'loader closed')
                }
            }
        }
    }

    close(){
        this.closed = true;
    }

    ls(path) {
        return window.fetch(buildUrl('/tree'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'omit',
            body: JSON.stringify({
                EndpointURI: this.uri,
                Path: path,
            })
        }).then(response => {
            if (response.status === 500) {
                return response.json().then(data => {
                    if(data && data.error) {
                        throw new Error(data.error);
                    }
                });
            }
            return response.json();
        }).then(data => {
            const children = data.Children || [];
            if ( (path === "/" || path === "") && children.length === 0) {
                throw new Error("tree.error.empty-root");
            }
            return children;
        }).catch(reason => {
            this.errorHandler(reason);
            throw reason;
        });
    }

    mkdir(path){
        return window.fetch(buildUrl('/tree'), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'omit',
            body: JSON.stringify({
                EndpointURI: this.uri,
                Path: path,
            })
        }).then(response => {
            if (response.status === 500) {
                console.log(response);
                return response.json().then(data => {
                    console.log(data);
                    if(data && data.error) {
                        throw new Error(data.error);
                    }
                });
            }
            return response.json();
        }).catch(reason => {
            console.log(reason);
            this.errorHandler(reason);
            throw reason;
        });

    }
}

export {TreeNode, Loader}