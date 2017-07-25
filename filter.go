package sync

import (
	"log"
	"time"

	"github.com/deckarep/golang-set"
	"github.com/pydio/services/common/proto/tree"
	"github.com/thejerf/suture"
)

const filtDuration = time.Second * 1

// implements Target
type filter struct {
	chHalt chan struct{}

	*suture.Supervisor
	filt mapset.Set

	Endpoint
	w *watcher
	b *batcher
}

// Batches applies a filter to the underlying batcher's NextBatch method
func (f filter) Batches() <-chan Batch {
	ch := make(chan Batch)

	go func() {
		for b := range f.b.Batches() {
			if b = f.applyFilter(b); len(b) > 0 {
				ch <- b
			}
		}
	}()

	return ch
}

func (f filter) applyFilter(b Batch) (filtered Batch) {
	for _, ev := range b {
		if f.filt.Contains(ev.Path) {
			continue // Ignore the event
		}

		filtered = append(filtered, ev)
	}

	return
}

func (f filter) addToFilter(p string) {
	f.filt.Add(p)
	go func() {
		<-time.After(filtDuration)
		f.filt.Remove(p)
	}()
}

func (f filter) CreateNode(n *tree.Node, updateIfExist bool) error {
	f.addToFilter(n.GetPath())
	return f.Endpoint.CreateNode(n, updateIfExist)
}

func (f filter) UpdateNode(n *tree.Node) error {
	f.addToFilter(n.GetPath())
	return f.Endpoint.UpdateNode(n)
}

func (f filter) LoadNode(p string, leaf ...bool) (*tree.Node, error) {
	f.addToFilter(p)
	return f.Endpoint.LoadNode(p, leaf...)
}

func (f filter) DeleteNode(p string) error {
	f.addToFilter(p)
	return f.Endpoint.DeleteNode(p)
}

func (f filter) MoveNode(src string, dst string) error {
	f.addToFilter(src)
	f.addToFilter(dst)
	return f.Endpoint.MoveNode(src, dst)
}

func (f *filter) Serve() {
	f.chHalt = make(chan struct{})

	go func() {
		for {
			select {
			case ev := <-f.w.Events():
				f.b.RecvEvent(ev)
			case <-f.chHalt:
				return
			}
		}
	}()

	go func() {
		for {
			select {
			case err := <-f.w.Errors():
				log.Fatal(err) // TODO : tie this into a sensible error propagation scheme
			case <-f.chHalt:
				return
			}
		}
	}()

	f.Supervisor.Serve()
}

func (f filter) Stop() {
	close(f.chHalt)
	f.Supervisor.Stop()
}

func newTarget(end Endpoint, path string) Target {
	w := &watcher{watchable: end, path: path}
	b := &batcher{}

	sup := suture.NewSimple("")
	sup.Add(w)
	sup.Add(b)

	return &filter{
		Supervisor: sup,
		filt:       mapset.NewSet(),
		Endpoint:   end,
		w:          w,
		b:          b,
	}
}